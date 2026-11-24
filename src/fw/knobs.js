/* Knob values, kept per policy. A knob is a named value a policy reads
 * (`knob("port") ?? 80`, `kstr("bad_host")`) and the host may set; here a
 * value belongs to the policy it was set for, so two policies that both
 * declare `port` do not share one.
 *
 * pfw-core itself carries a value from program to program by name, so
 * every apply is given a value for every knob the policy declares: what
 * was set for it, else its default.
 */
const U64_MAX = (1n << 64n) - 1n;
const STRING_CAP = 64;

// A numeric knob's value as typed: decimal or 0x hex, within 64 bits.
function parseNumber(name, raw) {
  if (!/^(?:\d+|0x[0-9a-f]+)$/i.test(raw)) throw new Error(`Knob ${name} is a number: ${raw} is not one`);
  const value = BigInt(raw);
  if (value > U64_MAX) throw new Error(`Knob ${name} holds 64 bits: ${raw} does not fit`);
  return value;
}

function parseString(name, raw) {
  if (raw.length > STRING_CAP) throw new Error(`Knob ${name} holds ${STRING_CAP} bytes: that is ${raw.length}`);
  return raw;
}

const PARSE = { number: parseNumber, string: parseString };

export class Knobs {
  // policy key -> { knob name -> value as it was typed }
  #set = new Map();

  constructor(saved = {}) {
    for (const [key, values] of Object.entries(saved ?? {})) this.#set.set(key, { ...values });
  }

  // The policy's knob `name`, or a refusal that lists the ones it has.
  #declared(policy, name) {
    const knob = policy.knobs.find((k) => k.name === name);
    if (knob) return knob;
    const have = policy.knobs.map((k) => k.name).join(", ") || "none";
    throw new Error(`${policy.key} has no knob ${name} (it has: ${have})`);
  }

  // Sets `name` for `policy` and returns the value a VM should be given.
  set(policy, name, raw) {
    const knob = this.#declared(policy, name);
    const value = PARSE[knob.kind](name, raw);
    this.#set.set(policy.key, { ...this.#set.get(policy.key), [name]: raw });
    return { knob, value };
  }

  // Back to the default, which is returned for a VM to be given.
  unset(policy, name) {
    const knob = this.#declared(policy, name);
    const { [name]: _dropped, ...rest } = this.#set.get(policy.key) ?? {};
    if (Object.keys(rest).length > 0) this.#set.set(policy.key, rest);
    else this.#set.delete(policy.key);
    return { knob, value: knob.default };
  }

  // Every knob of `policy` with the value it now has and whether it was set.
  of(policy) {
    const set = this.#set.get(policy.key) ?? {};
    return policy.knobs.map((knob) => {
      const isSet = Object.hasOwn(set, knob.name);
      return { ...knob, set: isSet, value: isSet ? PARSE[knob.kind](knob.name, set[knob.name]) : knob.default };
    });
  }

  // What `PfwVm.apply` takes: a value for every knob the policy declares.
  options(policy) {
    const values = this.of(policy);
    const pick = (kind) => Object.fromEntries(values.filter((k) => k.kind === kind).map((k) => [k.name, k.value]));
    return { knobs: pick("number"), knobStrs: pick("string") };
  }

  // What is kept across restarts.
  toJSON() {
    return Object.fromEntries(this.#set);
  }
}
