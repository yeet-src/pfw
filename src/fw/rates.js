/* How fast the counters are moving. The VM only counts, so speed comes from
 * sampling it: a sample a second, the last minute of them kept, and a rate
 * is the difference between two samples over the time between them.
 */
export const WINDOW = 60;

// The counters a speed is worth knowing for, by the name it is shown under.
const SPEEDS = {
  packets: (s) => s.seen,
  passed: (s) => s.passed,
  // Every blocked packet is in `dropped` or in `rsts`, once. `bans` counts
  // ban verdicts, whose packets are in `dropped` already: adding it counted
  // them twice.
  blocked: (s) => (s.dropped ?? 0n) + (s.rsts ?? 0n),
  "would block": (s) => s.shadowed,
  scanned: (s) => s.scanned_bytes,
  flows: (s) => s.flows_created,
};

const num = (v) => Number(v ?? 0);

export class Rates {
  // { at, values: { name -> count }, rules: { rule -> hits } }, oldest first
  #samples = [];

  /* A counter that went down means the VM behind it is a new one: the
   * samples before it measure something else, and are dropped.
   */
  push(stats, at) {
    const values = Object.fromEntries(Object.entries(SPEEDS).map(([name, read]) => [name, num(read(stats))]));
    const rules = Object.fromEntries(Object.entries(stats.rules ?? {}).map(([rule, hits]) => [rule, num(hits)]));

    const last = this.#samples.at(-1);
    if (last && Object.keys(values).some((name) => values[name] < last.values[name])) this.#samples = [];

    this.#samples.push({ at, values, rules });
    if (this.#samples.length > WINDOW + 1) this.#samples.shift();
  }

  reset() {
    this.#samples = [];
  }

  // Per second between two samples; 0 when they are the same instant.
  static #rate(from, to, read) {
    const seconds = (to.at - from.at) / 1000;
    return seconds > 0 ? Math.max(0, read(to) - read(from)) / seconds : 0;
  }

  /* Every speed three ways: over the last second, over the whole window,
   * and the fastest second in it, with the per-second history a sparkline
   * draws. Null until there are two samples to compare.
   */
  speeds() {
    const samples = this.#samples;
    if (samples.length < 2) return null;

    const [first, last] = [samples[0], samples.at(-1)];
    return Object.fromEntries(Object.keys(SPEEDS).map((name) => {
      const read = (sample) => sample.values[name];
      const history = samples.slice(1).map((sample, i) => Rates.#rate(samples[i], sample, read));
      return [name, { now: history.at(-1), mean: Rates.#rate(first, last, read), peak: Math.max(...history), history }];
    }));
  }

  // Hits per second by rule, over the window.
  ruleSpeeds() {
    const samples = this.#samples;
    if (samples.length < 2) return {};
    const [first, last] = [samples[0], samples.at(-1)];
    return Object.fromEntries(Object.keys(last.rules).map((rule) =>
      [rule, Rates.#rate(first, last, (sample) => sample.rules[rule] ?? 0)]));
  }

  get seconds() {
    const samples = this.#samples;
    return samples.length < 2 ? 0 : Math.round((samples.at(-1).at - samples[0].at) / 1000);
  }
}

/* Where a fraction of the decisions fall in the histogram: the bound the
 * `q`th of them is under, or null when that is past the last bound.
 */
export function quantile({ bounds = [], counts = [] } = {}, q) {
  const total = counts.reduce((sum, c) => sum + num(c), 0);
  if (total === 0) return undefined;

  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    seen += num(counts[i]);
    if (seen >= q * total) return i < bounds.length ? bounds[i] : null;
  }
  return null;
}
