/* Knobs of their own for every policy in place. pfw-core keeps one table of
 * knobs for all the programs it runs and finds a knob's slot by its name,
 * so two programs that both say `port` would read one value. Here a policy
 * in place has a scope, a small number, and its knobs go to the VM named by
 * that scope and their place in the policy's own numbering: `2 0` is scope
 * 2's first knob. The kernel sees slots, never the names.
 *
 * A name owns its slot for as long as the VM lives, so scopes are numbers
 * that are used again, not the policies' own names: the slots taken are
 * bounded by the policies in place at once, however many come and go. A
 * policy keeps its scope while it is in place, and one that arrives never
 * takes the scope of one still there.
 */

const scopedName = (scope, slot) => `${scope} ${slot}`;
const ofKind = (policy, kind) => policy.knobs.filter((k) => k.kind === kind);

export class Scopes {
  // policy key -> its scope
  #held = new Map();

  // The scope of the policy with `key`: the one it has, else the lowest free.
  of(key) {
    if (!this.#held.has(key)) {
      const taken = new Set(this.#held.values());
      let scope = 0;
      while (taken.has(scope)) scope++;
      this.#held.set(key, scope);
    }
    return this.#held.get(key);
  }

  // Frees the scope of every policy whose key is not among `keys`.
  keep(keys) {
    const staying = new Set(keys);
    for (const key of [...this.#held.keys()]) if (!staying.has(key)) this.#held.delete(key);
  }
}

// The name the VM knows `policy`'s knob `name` of `kind` by, or null if it has none.
export function scopedKnob(scope, policy, { name, kind }) {
  const slot = ofKind(policy, kind).findIndex((k) => k.name === name);
  return slot < 0 ? null : scopedName(scope, slot);
}

/* What `PfwVm` is handed for `policy` in `scope`: its program with the knobs
 * renamed, and a value for every one of them, `values` being `Knobs.of`.
 */
export function scoped(scope, policy, values) {
  const renamed = (kind) => ofKind(policy, kind).map((_, slot) => scopedName(scope, slot));
  const valued = (kind) => Object.fromEntries(values.filter((k) => k.kind === kind).map((k, slot) => [scopedName(scope, slot), k.value]));

  return {
    program: { ...policy.compiled, knobs: renamed("number"), knobStrs: renamed("string") },
    options: { knobs: valued("number"), knobStrs: valued("string") },
  };
}
