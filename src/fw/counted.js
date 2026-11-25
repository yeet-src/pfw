/* What each policy in place has counted. `PfwVm.stats()` keeps the default's
 * rules at its top, the routes' by the name the VM gives a route and the
 * chain's in a list; here they are one list, `programs`, each under the
 * name status gives it. Pure.
 */

// The slot pfw-core counts packets that ended on no rule under.
export const NO_RULE = "-";

const num = (v) => Number(v ?? 0);
const counts = ({ rules = {}, enforced_rules = {}, timing = {}, applied_at = null } = {}) => ({ rules, enforced_rules, timing, applied_at });

// `stats` with `programs`, one for every entry of `rules`.
export function withPrograms(stats, rules) {
  const { routes = {}, first = [], ...rest } = stats;

  let stage = 0;
  const from = (place) => (place.kind === "default" ? stats : place.kind === "first" ? first[stage++] : routes[place.route.counted]);
  const programs = rules.entries().map(({ at, place, policy }) => ({ at, policy: policy.name, ...counts(from(place)) }));

  return { ...rest, programs };
}

// Stats that carry no `programs` are one program's, the default's.
const programsOf = (stats) => stats.programs ?? [{ at: "default", ...counts(stats) }];

/* Every rule of every program, the busiest first. A rule's name is its own
 * within its program, so with several in place it is shown with where it is.
 */
export function ruleCounts(stats) {
  const programs = programsOf(stats);
  const several = programs.length > 1;

  return programs
    .flatMap(({ at, rules, enforced_rules, timing }) =>
      Object.entries(rules)
        .filter(([rule]) => rule !== NO_RULE)
        .map(([rule, hits]) => ({
          id: `${at}\n${rule}`,
          at,
          rule,
          name: several ? `${rule} (${at})` : rule,
          hits: num(hits),
          stopped: num(enforced_rules[rule]),
          timing: timing[rule],
        })))
    .sort((a, b) => b.hits - a.hits);
}

// The packets that ended on no rule, in every program: `{ runs, ns }`.
export function unmatched(stats) {
  return programsOf(stats)
    .map(({ timing }) => timing[NO_RULE])
    .reduce((sum, t) => ({ runs: sum.runs + num(t?.runs), ns: sum.ns + num(t?.ns) }), { runs: 0, ns: 0 });
}
