/* The firewall: one PfwVm on the service's interfaces, and the policy it is
 * enforcing. The only module that touches the kernel side.
 */
import { PfwVm } from "pfw-core/loader";

import { Knobs } from "#/fw/knobs.js";
import { Rates } from "#/fw/rates.js";

// The counters of `PfwVm.stats()` a report carries.
const COUNTERS = ["seen", "passed", "dropped", "rsts", "bans", "faults"];

export class Firewall {
  #vm;
  #interfaces;
  #startedAt = null;
  #policy = null;
  #appliedAt = null;

  #object;
  #base;
  #knobs;
  #shadow;
  #rates = new Rates();

  constructor({ interfaces, object, base, knobs, shadow = false }) {
    this.#knobs = new Knobs(knobs);
    this.#shadow = Boolean(shadow);
    this.#object = object;
    this.#base = base;
    this.#interfaces = interfaces;
    this.#vm = this.#vmOn(interfaces);
  }

  // No interfaces, no VM: a PfwVm always owns at least one hook.
  #vmOn(interfaces) {
    if (interfaces.length === 0) return null;
    return new PfwVm({ iface: interfaces.map((i) => i.index), object: this.#object, base: this.#base });
  }

  get interfaces() {
    return this.#interfaces;
  }

  get policy() {
    return this.#policy;
  }

  // Attached with no policy: everything passes until one is applied.
  async start() {
    await this.#startVm();
    this.#startedAt = Date.now();
  }

  // A VM starts out enforcing, whatever the one before it was doing.
  async #startVm() {
    await this.#vm?.start();
    if (this.#shadow) await this.#vm?.setShadow(true);
  }

  get shadow() {
    return this.#shadow;
  }

  /* Shadow mode is a dry run: the policy decides and counts as usual, and
   * every packet passes. It is the firewall's, not a policy's, so it holds
   * across `apply`.
   */
  async setShadow(on) {
    this.#shadow = on;
    await this.#vm?.setShadow(on);
  }

  async stop() {
    await this.#vm?.stop();
    this.#startedAt = null;
    this.#policy = null;
    this.#appliedAt = null;
  }

  /* Moves the firewall to `interfaces`, which may be none: it then holds no
   * hook and filters nothing, and keeps its policy for when it is attached
   * again. The hooks are released before the new ones are taken, since the
   * two sets may overlap, so flows, bans and counters start over. If the
   * new ones cannot be taken, it goes back to where it was.
   */
  async attach(interfaces) {
    const was = this.#vm;
    await was?.stop();

    try {
      this.#vm = this.#vmOn(interfaces);
      await this.#startVm();
      this.#interfaces = interfaces;
    } catch (error) {
      this.#vm = was;
      await this.#startVm();
      await this.#enforceOnVm();
      throw error;
    }

    await this.#enforceOnVm();
  }

  async #enforceOnVm() {
    if (this.#vm && this.#policy) await this.#vm.apply(this.#policy.compiled, { ...this.#knobs.options(this.#policy), shadow: this.#shadow });
  }

  get knobs() {
    return this.#knobs;
  }

  // The policy a knob command means when it names none: the one enforcing.
  get knobTarget() {
    if (!this.#policy) throw new Error("No policy is enforcing: name one");
    return this.#policy;
  }

  // Whether `policy` is the one in the kernel now, whatever its revision.
  #isLive(policy) {
    return this.#vm !== null && this.#policy?.key === policy.key;
  }

  // A knob of the enforcing policy changes on the next packet, with no reload.
  async #push({ knob, value }) {
    if (knob.kind === "number") await this.#vm.setKnob(knob.name, value);
    else await this.#vm.setKnobStr(knob.name, value);
  }

  async setKnob(policy, name, raw) {
    const change = this.#knobs.set(policy, name, raw);
    if (this.#isLive(policy)) await this.#push(change);
  }

  async unsetKnob(policy, name) {
    const change = this.#knobs.unset(policy, name);
    if (this.#isLive(policy)) await this.#push(change);
  }

  // An atomic swap: flows and bans survive, rule counts start over.
  async enforce(policy) {
    this.#policy = policy;
    this.#appliedAt = Date.now();
    await this.#enforceOnVm();
  }

  // Stops enforcing but stays attached; standing bans still apply.
  async clear() {
    await this.#vm?.clear();
    this.#policy = null;
    this.#appliedAt = null;
  }

  // One sample of the counters, for the speeds. Called once a second.
  async sample() {
    if (this.#vm) this.#rates.push(await this.#vm.stats(), Date.now());
    else this.#rates.reset();
  }

  get rates() {
    return this.#rates;
  }

  // Attached to nothing, there is nothing to count.
  async stats() {
    return this.#vm ? this.#vm.stats() : { shadow: this.#shadow, rules: {} };
  }

  status() {
    return {
      running: this.#startedAt !== null,
      started_at: this.#startedAt,
      interfaces: this.#interfaces,
      policy: this.#policy ? { ...this.#describe(this.#policy), applied_at: this.#appliedAt } : null,
    };
  }

  // A policy with its knobs as they are set for it.
  #describe(policy) {
    return { ...policy.describe(), knobs: this.#knobs.of(policy) };
  }

  // The status with the counters a person reads beside it.
  async report(stats = null) {
    stats ??= await this.stats();
    const counters = Object.fromEntries(COUNTERS.map((key) => [key, stats[key] ?? 0n]));
    return { ...this.status(), shadow: this.#shadow, shadowed: stats.shadowed ?? 0n, counters, rules: stats.rules };
  }
}
