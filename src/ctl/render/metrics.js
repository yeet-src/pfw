/* `PfwVm.stats()` as the page `pfw metrics` prints: where the packets
 * went, which rules took them, how long deciding took, and whatever else
 * the VM counted.
 */
import { bytes, count, nanos } from "#/ctl/render/format.js";
import { bar, percent, sparkline } from "#/ctl/render/bars.js";
import { cell, table } from "#/ctl/render/table.js";
import { quantile } from "#/fw/rates.js";

// The slot pfw-core counts packets that ended on no rule under.
const NO_RULE = "-";

const VERDICTS = [["pass", "passed"], ["drop", "dropped"], ["rst", "rsts"]];
// Shown in their own sections, or as the unit of another counter.
const ELSEWHERE = new Set(["seen", "passed", "dropped", "rsts", "bans", "decide_ns"]);
const AS_BYTES = new Set(["scanned_bytes"]);

const num = (v) => Number(v ?? 0);

const perSecond = (name, rate) => `${name === "scanned" ? bytes(Math.round(rate)) : count(Math.round(rate))}/s`;

// How fast, three ways, with the last half minute drawn. A speed that has
// never moved in the window says nothing.
function speed({ speeds, window }, p) {
  if (!speeds) return [];
  const moving = Object.entries(speeds).filter(([, s]) => s.peak > 0);
  if (moving.length === 0) return [`${p.label("speed")}  ${p.note(`nothing moved in the last ${window}s`)}`];

  return [
    `${p.label("speed")}  ${p.note(`now, mean and peak over the last ${window}s`)}`,
    ...table(moving.map(([name, s]) => [
      cell(p.name, name),
      cell(p.strong, perSecond(name, s.now)),
      cell(p.value, perSecond(name, s.mean)),
      cell(p.note, perSecond(name, s.peak)),
      cell(name === "blocked" || name === "would block" ? p.warn : p.ok, sparkline(s.history)),
    ])),
  ];
}

function packets(stats, p) {
  const seen = num(stats.seen);
  return [
    `${p.label("packets")}  ${p.strong(count(seen))} ${p.note("seen")}`,
    ...table(VERDICTS.map(([verdict, key]) => {
      const n = num(stats[key]);
      const tone = verdict === "pass" ? p.ok : n > 0 ? p.warn : p.value;
      return [cell(p.name, verdict), cell(tone, count(n)), cell(p.note, percent(n, seen)), cell(tone, bar(seen ? n / seen : 0))];
    })),
  ];
}

/* pfw-core also keeps a slot for the packets that ended on no rule at all
 * (a bare `decide pass`). It is not a rule, so it is not listed as one: what
 * it took to decide those is said under the list.
 */
function rules(stats, p, ruleSpeeds = {}) {
  const rows = Object.entries(stats.rules ?? {})
    .filter(([name]) => name !== NO_RULE)
    .map(([name, hits]) => ({ name, hits: num(hits), timing: stats.timing?.[name] }))
    .sort((a, b) => b.hits - a.hits);
  const clean = stats.timing?.[NO_RULE];
  if (rows.length === 0 && !(num(clean?.runs) > 0)) return [];

  const most = Math.max(1, ...rows.map((r) => r.hits));
  // The speed column is there only while a rule is being hit.
  const anyMoving = rows.some((r) => ruleSpeeds[r.name] > 0);
  return [
    `${p.label("rules")}  ${p.note(anyMoving ? "hits, mean decision time, hits a second" : "hits, mean decision time")}`,
    ...(rows.length > 0 ? table(rows.map(({ name, hits, timing }) => {
      const runs = num(timing?.runs);
      return [
        cell(p.name, name),
        cell(p.value, count(hits)),
        cell(p.note, runs > 0 ? nanos(num(timing.ns) / runs) : ""),
        ...(anyMoving ? [cell(p.note, ruleSpeeds[name] > 0 ? `${count(Math.round(ruleSpeeds[name]))}/s` : "")] : []),
        cell(p.value, bar(hits / most)),
      ];
    })) : []),
    ...(num(clean?.runs) > 0
      ? [`  ${p.note(`packets that matched no rule took ${nanos(num(clean.ns) / num(clean.runs))} each to pass`)}`]
      : []),
  ];
}

function decisions(stats, p) {
  const { bounds = [], counts = [] } = stats.decide_hist ?? {};
  const total = counts.reduce((sum, c) => sum + num(c), 0);
  if (total === 0) return [];

  const most = Math.max(...counts.map(num));
  const rows = counts
    .map((c, i) => ({ n: num(c), label: i < bounds.length ? `< ${nanos(bounds[i])}` : `≥ ${nanos(bounds[bounds.length - 1])}` }))
    .filter((r) => r.n > 0);
  return [
    `${p.label("decision time")}  ${p.note(`mean ${nanos(num(stats.decide_ns) / total)} over ${count(total)}`)}   ${percentiles(stats.decide_hist, p)}`,
    ...table(rows.map((r) => [cell(p.name, r.label), cell(p.value, count(r.n)), cell(p.note, percent(r.n, total)), cell(p.value, bar(r.n / most))])),
  ];
}

// The histogram only knows buckets, so a percentile is the bound it is under.
function percentiles(hist, p) {
  const last = hist.bounds?.at(-1);
  return [50, 90, 99].map((q) => {
    const bound = quantile(hist, q / 100);
    return `${p.label(`p${q}`)} ${p.value(bound === null ? `≥ ${nanos(last)}` : `< ${nanos(bound)}`)}`;
  }).join("  ");
}

// Every other counter that has counted something.
function engine(stats, p) {
  const rows = Object.entries(stats)
    .filter(([key, v]) => typeof v === "bigint" && !ELSEWHERE.has(key) && v > 0n)
    .map(([key, v]) => [cell(p.name, key.replaceAll("_", " ")), cell(key === "faults" ? p.bad : p.value, AS_BYTES.has(key) ? bytes(v) : count(v))]);
  return rows.length ? [p.label("engine"), ...table(rows)] : [];
}

export function metrics({ attached, stats, speeds = null, ruleSpeeds = {}, window = 0 }, p) {
  if (!attached) return p.warn("attached to no interface: nothing is counted");

  return [
    packets(stats, p),
    speed({ speeds, window }, p),
    rules(stats, p, ruleSpeeds),
    decisions(stats, p),
    engine(stats, p),
  ]
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join("\n"))
    .join("\n\n");
}
