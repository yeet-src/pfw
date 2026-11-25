/* What the firewall is set to, across restarts: the interfaces it is
 * attached to, the policies in place and where, the ones before them, the
 * knobs set per policy and whether it is in shadow mode. An isolate has no
 * storage, so the state is kept as a JavaScript module on the host: the
 * `pfw` command writes the module this service hands it, and the next start
 * imports it back.
 *
 * A set of policies is kept as `{ policy, routes, first }`: the default, a
 * list of `{ at, policy }` with `at` the route's spec, and the chain in
 * order, every policy as `{ name, source }`. The module's own `policy`,
 * `routes` and `first` are the ones in place.
 */
import { DEFAULT, FIRST, parsePlace } from "#/fw/place.js";
import { Policy } from "#/fw/policy.js";
import { Ruleset } from "#/fw/ruleset.js";

const kept = (policy) => (policy ? { name: policy.name, source: policy.source } : null);

const keptRules = (rules) => ({
  policy: kept(rules.default),
  routes: rules.routes.map(({ route, policy }) => ({ at: route.spec, policy: kept(policy) })),
  first: rules.first.map(kept),
});

// A file from before there were places kept the policy before as itself.
const keptBefore = (previous) => (previous && "source" in previous ? { policy: previous } : previous);

export class SavedState {
  constructor(path) {
    this.path = path;
  }

  // The module to save for the firewall as it now stands.
  moduleOf(firewall) {
    const { rules, shadow } = firewall.settled;
    return `export default ${JSON.stringify({
      interfaces: firewall.interfaces.map((i) => i.name),
      ...keptRules(rules),
      previous: firewall.previous && !firewall.previous.empty ? keptRules(firewall.previous) : null,
      knobs: firewall.knobs,
      shadow,
    })};\n`;
  }

  // What was saved, or null when nothing was or it cannot be read.
  async read() {
    try {
      return (await import(this.path)).default ?? null;
    } catch (error) {
      const message = error?.message ?? String(error);
      if (!message.includes("Module not found")) console.log(`pfw: saved state ${this.path} was not read: ${message}`);
      return null;
    }
  }

  /* A saved policy that will not load is reported and left out: the
   * firewall still comes up, and `pfw status` shows what it is enforcing
   * without it.
   */
  async restorePolicy(firewall, saved) {
    // Remembered after the policies are enforced, which would overwrite it.
    const previous = this.#placed(firewall, keptBefore(saved?.previous), () => {});

    let restored = 0;
    for (const [place, policy] of this.#placed(firewall, saved, console.log)) {
      try {
        await firewall.enforce(policy, place);
        restored++;
        console.log(`pfw: restored ${policy.name}${place === DEFAULT ? "" : ` at ${place.label}`}`);
      } catch (error) {
        console.log(`pfw: saved policy ${policy.name} was not restored: ${error?.message ?? error}`);
      }
    }

    const before = previous.reduce((rules, [place, policy]) => {
      try {
        return rules.with(place, policy);
      } catch {
        return rules;
      }
    }, Ruleset.EMPTY);
    // Restoring was not a change to undo: what was before is what was saved.
    if (restored > 0 || !before.empty) firewall.remember(before);
  }

  // The kept policies that compile, each with its place: `[place, policy]`.
  #placed(firewall, keptSet, say) {
    const all = [
      [DEFAULT.spec, keptSet?.policy],
      ...(keptSet?.first ?? []).map((policy) => [FIRST.spec, policy]),
      ...(keptSet?.routes ?? []).map(({ at, policy }) => [at, policy]),
    ];

    return all.filter(([, policy]) => policy).flatMap(([at, { name, source }]) => {
      try {
        return [[parsePlace(at, firewall.interfaces), new Policy(name, source)]];
      } catch (error) {
        say(`pfw: saved policy ${name} was not restored: ${error?.message ?? error}`);
        return [];
      }
    });
  }
}
