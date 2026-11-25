/* The firewall: one PfwVm on the service's interfaces, and the policies it
 * is enforcing, each in its place. The only module that touches the kernel
 * side.
 */
import { PfwVm } from "pfw-core/loader";

import { withPrograms } from "#/fw/counted.js";
import { Knobs } from "#/fw/knobs.js";
import { DEFAULT, FIRST } from "#/fw/place.js";
import { Rates } from "#/fw/rates.js";
import { Ruleset } from "#/fw/ruleset.js";
import { Scopes, scoped, scopedKnob } from "#/fw/scopes.js";
import { Trial } from "#/fw/trial.js";

// The counters of `PfwVm.stats()` a report carries.
const COUNTERS = ["seen", "passed", "dropped", "rsts", "bans", "faults"];

export class Firewall {
  #vm;
  #interfaces;
  #startedAt = null;
  #rules = Ruleset.EMPTY;
  // place spec -> when what is there was put there
  #since = new Map();

  #object;
  #base;
  #knobs;
  #scopes = new Scopes();
  #shadow;
  #rates = new Rates();

  // The policies before the last change; undefined until there has been one.
  #previous;
  #trial = new Trial((before) => this.#lapse(before));
  #lapsedAt = null;

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

  get rules() {
    return this.#rules;
  }

  // The default: the policy of every packet no route claims.
  get policy() {
    return this.#rules.default;
  }

  // Attached with no policy: everything passes until one is applied.
  async start() {
    await this.#startVm();
    this.#startedAt = Date.now();
  }

  // A VM starts out enforcing, whatever the one before it was doing, and
  // with every knob slot free.
  async #startVm() {
    this.#scopes = new Scopes();
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
    this.#lapsedAt = null;
    this.#shadow = on;
    await this.#vm?.setShadow(on);
  }

  async stop() {
    await this.#vm?.stop();
    this.#startedAt = null;
    this.#rules = Ruleset.EMPTY;
    this.#since.clear();
  }

  /* Moves the firewall to `interfaces`, which may be none: it then holds no
   * hook and filters nothing, and keeps its policies for when it is attached
   * again. The hooks are released before the new ones are taken, since the
   * two sets may overlap, so flows, bans and counters start over. If the
   * new ones cannot be taken, it goes back to where it was.
   */
  async attach(interfaces) {
    const stranded = this.#rules.routes.find(({ route }) => route.iface && !interfaces.some((i) => i.index === route.iface.index));
    if (stranded) throw new Error(`The route ${stranded.route.label} is for ${stranded.route.iface.name}: clear it before detaching`);

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

  // A new VM holds nothing: every policy goes back to its place.
  async #enforceOnVm() {
    for (const [place, value] of this.#rules.changesFrom(Ruleset.EMPTY)) await this.#put(place, value);
  }

  /* One place in the kernel made to hold `value`, in the form
   * `Ruleset.put` takes it. Each is an atomic swap: flows and bans survive,
   * and the rule counts of that place start over.
   */
  async #put(place, value) {
    if (!this.#vm) return;

    if (place.kind === FIRST.kind) {
      const chain = value.map((policy) => this.#forVm(policy));
      await this.#vm.first(chain.length > 0 ? chain.map(({ program }) => program) : null, chain.map(({ options }) => options));
    } else if (place.kind === DEFAULT.kind) {
      // Standing bans still apply once the default is cleared.
      if (value) await this.#vm.apply(this.#forVm(value).program, { ...this.#forVm(value).options, shadow: this.#shadow });
      else await this.#vm.clear();
    } else if (value) await this.#vm.route(place.route.match, this.#forVm(value).program, this.#forVm(value).options);
    else await this.#vm.unroute(place.route.match);
  }

  // `policy` as the VM is handed it: its knobs its own, and each with a value.
  #forVm(policy) {
    return scoped(this.#scopes.of(policy.key), policy, this.#knobs.of(policy));
  }

  /* Moves the kernel from the policies in place to `next`, a place at a
   * time. If one cannot be put, the ones already moved go back: half a
   * change is neither what was asked for nor what was there.
   */
  async #move(next) {
    const from = this.#rules;

    try {
      for (const [place, value] of next.changesFrom(from)) {
        await this.#put(place, value);
        this.#rules = this.#rules.put(place, value);
        this.#since.set(place.spec, Date.now());
      }
    } catch (error) {
      for (const [place, value] of from.changesFrom(this.#rules)) {
        await this.#put(place, value).catch((failure) => console.log(`pfw: ${place.label} could not be put back: ${failure?.message ?? failure}`));
      }
      this.#rules = from;
      throw error;
    } finally {
      // Only now: a policy that left kept its scope until the ones that came had theirs.
      this.#scopes.keep(this.inPlace.map((policy) => policy.key));
    }
  }

  async #change(next) {
    const before = this.#rules;
    await this.#move(next);
    this.#lapsedAt = null;
    this.#previous = before;
  }

  get knobs() {
    return this.#knobs;
  }

  // The policies in place, one of each whatever its revision or its places.
  get inPlace() {
    return [...new Map(this.#rules.entries().map(({ policy }) => [policy.key, policy])).values()];
  }

  // Whether `policy` is in place, whatever its revision.
  isInPlace(policy) {
    return this.inPlace.some((p) => p.key === policy.key);
  }

  /* A knob of a policy in place changes on the next packet, with no reload.
   * The slot is the one the policy in place gave it, which a later revision
   * may number otherwise.
   */
  async #push(policy, { knob, value }) {
    const live = this.inPlace.find((p) => p.key === policy.key);
    const name = this.#vm && live ? scopedKnob(this.#scopes.of(live.key), live, knob) : null;
    if (name === null) return;

    if (knob.kind === "number") await this.#vm.setKnob(name, value);
    else await this.#vm.setKnobStr(name, value);
  }

  async setKnob(policy, name, raw) {
    await this.#push(policy, this.#knobs.set(policy, name, raw));
  }

  async unsetKnob(policy, name) {
    await this.#push(policy, this.#knobs.unset(policy, name));
  }

  // Puts `policy` at `place`, beside whatever is in the other places.
  async enforce(policy, place = DEFAULT) {
    await this.#change(this.#rules.with(place, policy));
  }

  // Empties `place`, or every place; it stays attached.
  async clear(place = null) {
    await this.#change(place ? this.#rules.without(place) : Ruleset.EMPTY);
  }

  // What a trial goes back to: the policies and whether they only rehearse.
  snapshot() {
    return { rules: this.#rules, shadow: this.#shadow };
  }

  // What a restart should come back to: a change on trial is not kept.
  get settled() {
    return this.#trial.before ?? this.snapshot();
  }

  get previous() {
    return this.#previous;
  }

  // The policies `rollback` returns to, as a restart left them.
  remember(rules) {
    this.#previous = rules;
  }

  // Into shadow before the policies change and out of it after, so nothing
  // is blocked on the way that neither state would block.
  async #restore({ rules, shadow }) {
    if (shadow) await this.setShadow(true);
    await this.#change(rules);
    if (!shadow) await this.setShadow(false);
  }

  /* Puts what was just changed on trial for `ms`: at the deadline the
   * firewall goes back to `before`, the snapshot taken ahead of the change,
   * unless `confirm` comes first.
   */
  tryFor(ms, before) {
    this.#trial.begin(before, ms);
  }

  get trial() {
    return this.#trial;
  }

  // Keeps what is on trial. False when nothing was.
  confirm() {
    return this.#trial.end() !== null;
  }

  async #lapse(before) {
    await this.#restore(before).catch((error) => console.log(`pfw: could not go back after the trial: ${error?.message ?? error}`));
    this.#lapsedAt = Date.now();
    console.log("pfw: the trial was not confirmed: back to what was running before it");
  }

  /* Undoes the last change of policy. With a trial pending, that is the
   * trial, now. Otherwise the policies in place before it come back, and
   * these become the ones before, so a second rollback returns.
   */
  async rollback() {
    const before = this.#trial.end();
    if (before) return this.#restore(before);
    if (this.#previous === undefined) throw new Error("There is nothing to roll back to");
    return this.#change(this.#previous);
  }

  // One sample of the counters, for the speeds. Called once a second.
  async sample() {
    if (this.#vm) this.#rates.push(await this.stats(), Date.now());
    else this.#rates.reset();
  }

  get rates() {
    return this.#rates;
  }

  // Attached to nothing, there is nothing to count.
  async stats() {
    return withPrograms(this.#vm ? await this.#vm.stats() : { shadow: this.#shadow, rules: {} }, this.#rules);
  }

  // `policy` is the default; `policies` is every one in place, it included.
  status() {
    const policies = this.#rules.entries().map(({ at, place, policy }) =>
      ({ at, place: place.kind, ...this.#describe(policy), applied_at: this.#since.get(place.spec) ?? null }));

    return {
      running: this.#startedAt !== null,
      started_at: this.#startedAt,
      interfaces: this.#interfaces,
      policy: policies.find((p) => p.place === DEFAULT.kind) ?? null,
      policies,
      on_trial: this.#trial.pending,
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
    return {
      ...this.status(),
      shadow: this.#shadow,
      shadowed: stats.shadowed ?? 0n,
      counters,
      rules: stats.rules,
      programs: stats.programs,
      trial: this.#trial.pending ? { until: this.#trial.until } : null,
      lapsed_at: this.#lapsedAt,
      previous: this.#previous?.entries().map(({ at, policy }) => ({ at, name: policy.name })) ?? null,
    };
  }
}
