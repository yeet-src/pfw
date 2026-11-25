/* What the app's boxes say, as rows of colored runs worked out from what
 * the worker sent. Pure: nothing here knows about the terminal, so the
 * dashboard (src/ui/dash.jsx) only arranges it.
 */
import { bar, chart, percent, resample, sparkline } from "#/ctl/render/bars.js";
import { bytes, count, duration, nanos, splitName } from "#/ctl/render/format.js";
import { ruleCounts, unmatched as unmatchedOf } from "#/fw/counted.js";
import { quantile } from "#/fw/rates.js";
import { NBSP, columns } from "#/ui/line.jsx";

const VERDICTS = [["pass", "passed"], ["drop", "dropped"], ["rst", "rsts"]];
const DOT = `${NBSP}·${NBSP}`;

export const num = (v) => Number(v ?? 0);
export const perSecond = (rate, unit = count) => `${unit(Math.round(rate ?? 0))}/s`;

// Cool at the foot of a graph, hot at its head: the 256-color cube's
// green to yellow to red.
const HEAT = [46, 82, 118, 154, 190, 226, 220, 214, 208, 202, 196];
const heat = (share) => HEAT[Math.min(HEAT.length - 1, Math.floor(share * HEAT.length))];

// The top box's title: is it up, where, enforcing what.
export function status({ report }, now) {
  const attached = report.interfaces.length > 0;
  // The default names the firewall; with none, the first policy in place does.
  const [named, ...others] = report.policies;
  const { source, rev } = named ? splitName(named.name) : {};
  return [
    ["strong", "pfw"], ["", NBSP], [attached ? "ok" : "warn", "●"], ["", NBSP],
    ["note", `up${NBSP}${duration(now - report.started_at).replaceAll(" ", NBSP)}`],
    ["frame", DOT],
    [attached ? "tag" : "warn", attached ? report.interfaces.map((i) => i.name).join(",") : "no interface"],
    ["frame", DOT],
    ...(named
      ? [["name", source], ...(rev ? [["frame", `${NBSP}@${NBSP}`], ["value", rev]] : []), ...(others.length > 0 ? [["note", `${NBSP}+${others.length}`]] : [])]
      : [["warn", `no${NBSP}policy:${NBSP}passing${NBSP}everything`]]),
    ...(report.shadow ? [["frame", DOT], ["warn", `SHADOW:${NBSP}nothing${NBSP}is${NBSP}blocked`]] : []),
  ];
}

// The far end of the status bar: what has come through, and what was stopped.
export function totals({ stats }) {
  const blocked = num(stats.dropped) + num(stats.rsts);
  return [
    ["note", `seen${NBSP}`], ["strong", count(num(stats.seen))], ["frame", DOT],
    ["note", `blocked${NBSP}`], [blocked > 0 ? "warn" : "strong", count(blocked)],
  ];
}

const UNIT = { scanned: bytes };

// What a graph is showing, for the far end of its border.
export function graphNote({ speeds: all }, key) {
  if (!all) return "measuring";
  const unit = UNIT[key] ?? count;
  return [
    ["strong", perSecond(all[key].now, unit)], ["frame", DOT],
    ["note", `peak${NBSP}${perSecond(all[key].peak, unit)}`], ["frame", DOT],
    ["note", `mean${NBSP}${perSecond(all[key].mean, unit)}`],
  ];
}

// One of the speeds over the window, stretched across the box and colored
// by how high the row is.
export function graph({ speeds: all }, key, width, height) {
  if (!all || height < 1) return [];
  return chart(resample(all[key].history, width), width, height).map((row, i) => [[heat((height - 1 - i) / height), row]]);
}

// A share as a meter: what is filled, then the track it runs in.
function meter(role, share, width) {
  const filled = bar(share, width);
  return [[role, filled], ["frame", "░".repeat(Math.max(0, width - filled.length))]];
}

// The verdicts as meters, then the totals that sit beside them.
export function verdicts({ stats }, width) {
  const seen = num(stats.seen);
  const room = Math.max(4, width - 20);
  const meters = VERDICTS.map(([verdict, key]) => {
    const n = num(stats[key]);
    const role = verdict === "pass" ? "ok" : n > 0 ? "warn" : "frame";
    return [
      ["label", verdict.padEnd(5)], ...meter(role, seen ? n / seen : 0, room),
      ["", NBSP], [role === "frame" ? "note" : role, count(n).padStart(6)], ["note", (percent(n, seen) || "").padStart(7)],
    ];
  });
  return [
    ...meters,
    [["label", "seen".padEnd(5)], ["strong", count(seen)], ["frame", DOT], ["label", "flows "], ["strong", count(num(stats.flows_created))]],
    [["label", "scan".padEnd(5)], ["strong", bytes(num(stats.scanned_bytes))], ["frame", DOT],
      num(stats.faults) > 0 ? ["bad", `${count(num(stats.faults))} faults`] : ["note", "no faults"]],
  ];
}

// How fast, with the last of the window drawn.
export function speeds({ speeds: all }, width) {
  const moving = Object.entries(all ?? {}).filter(([name, s]) => name === "packets" || s.peak > 0);
  const named = Math.max(...moving.map(([name]) => name.length), 0);
  return moving.map(([name, s]) => {
    const unit = name === "scanned" ? bytes : count;
    const role = name === "blocked" || name === "would block" ? "warn" : "ok";
    return [
      ["label", name.padEnd(named)], ["", NBSP], ["strong", perSecond(s.now, unit).padStart(9)], ["", NBSP],
      [role, sparkline(resample(s.history, Math.max(4, width - named - 11)), Math.max(4, width - named - 11))],
    ];
  });
}

/* The rules of every policy in place, the busiest first. pfw-core also
 * keeps a slot for the packets that ended on no rule at all (a bare
 * `decide pass`); that is not a rule, so it is kept apart, as `unmatched`.
 */
export const rulesOf = (view) => ruleCounts(view.stats);

// How long the packets no rule took were in deciding: the cost of a clean pass.
export function unmatched(view) {
  const { runs, ns } = unmatchedOf(view.stats);
  return [
    ["label", "matched no rule"], ["frame", DOT],
    ["label", "timed "], ["strong", count(runs)], ["frame", DOT],
    ["label", "mean "], ["value", runs > 0 ? nanos(ns / runs) : "none yet"],
  ];
}

const meanOf = (rule) => (num(rule.timing?.runs) > 0 ? nanos(num(rule.timing.ns) / num(rule.timing.runs)) : "");

const RULE_HEAD = ["rule", "hits", "share", "mean", "rate", ""];

// The list's heading and its rows, in the same columns.
export function ruleTable(view, list, width) {
  const total = list.reduce((sum, r) => sum + r.hits, 0);
  const most = Math.max(1, ...list.map((r) => r.hits));
  const cells = list.map((r) => [
    r.name, count(r.hits), percent(r.hits, total), meanOf(r),
    view.ruleSpeeds?.[r.id] > 0 ? perSecond(view.ruleSpeeds[r.id]) : "",
  ]);
  const widths = RULE_HEAD.slice(0, 5).map((head, col) => Math.max(head.length, ...cells.map((row) => row[col].length)));
  const meterWidth = Math.max(4, width - widths.reduce((sum, w) => sum + w + 2, 0));
  const ROLES = ["name", "strong", "note", "value", "ok"];

  return {
    head: RULE_HEAD.slice(0, 5).flatMap((head, col) => [["frame", col === 0 ? head.padEnd(widths[col]) : head.padStart(widths[col])], ["", "  "]]),
    rows: cells.map((row, i) => [
      ...row.flatMap((text, col) => [[ROLES[col], col === 0 ? text.padEnd(widths[col]) : text.padStart(widths[col])], ["", "  "]]),
      ...meter(heat(list[i].hits / most * 0.999), list[i].hits / most, meterWidth),
    ]),
  };
}

// The picked rule in a line, for the foot of the list.
export function ruleFoot(rule) {
  return [
    ["name", rule.name], ["frame", DOT],
    ["label", "timed "], ["strong", count(num(rule.timing?.runs))], ["frame", DOT],
    ["label", "mean "], ["value", meanOf(rule) || "none yet"], ["frame", DOT],
    ["label", "total "], ["value", nanos(num(rule.timing?.ns))],
  ];
}

const underOf = (stats) => (q) => {
  const bound = quantile(stats.decide_hist, q);
  const last = stats.decide_hist?.bounds?.at(-1);
  return bound === undefined ? "none yet" : bound === null ? `≥${nanos(last)}` : `<${nanos(bound)}`;
};

/* Decision time as a histogram. `summary` puts the percentiles in a line
 * above it and leaves out the buckets with nothing in them, for a box with
 * little room; without it, every bucket is a row.
 */
export function timing({ stats }, width, { summary = true } = {}) {
  const { bounds = [], counts = [] } = stats.decide_hist ?? {};
  const total = counts.reduce((sum, c) => sum + num(c), 0);
  if (total === 0) return { note: "no decisions yet", rows: [] };

  const under = underOf(stats);
  const most = Math.max(...counts.map(num));
  const buckets = counts
    .map((c, i) => ({ n: num(c), label: i < bounds.length ? `<${nanos(bounds[i])}` : `≥${nanos(bounds.at(-1))}`, at: i / Math.max(1, counts.length - 1) }))
    .filter((bucket) => !summary || bucket.n > 0);
  const named = Math.max(...buckets.map((b) => b.label.length));
  const counted = summary ? 0 : Math.max(...buckets.map((b) => count(b.n).length)) + 1;

  // A narrow box gives the percentiles a row each side of the break.
  const percentiles = width >= 38
    ? [[["label", "p50 "], ["strong", under(0.5)], ["frame", DOT], ["label", "p90 "], ["strong", under(0.9)], ["frame", DOT], ["label", "p99 "], ["value", under(0.99)]]]
    : [
      [["label", "p50 "], ["strong", under(0.5)], ["frame", DOT], ["label", "p90 "], ["strong", under(0.9)]],
      [["label", "p99 "], ["value", under(0.99)]],
    ];

  return {
    note: `mean${NBSP}${nanos(num(stats.decide_ns) / total)}`,
    rows: [
      ...(summary ? percentiles : []),
      // Slower buckets run hotter, as a graph's rows do.
      ...buckets.map((b) => [
        ["label", b.label.padEnd(named)], ["", NBSP],
        ...meter(heat(b.at * 0.999), b.n / most, Math.max(4, width - named - 8 - counted)),
        ...(summary ? [] : [[b.n > 0 ? "strong" : "frame", count(b.n).padStart(counted)]]),
        ["note", (percent(b.n, total) || "").padStart(7)],
      ]),
    ],
  };
}

// Label and value pairs, the values in a column.
const facts = (pairs) => {
  const named = Math.max(...pairs.map(([label]) => label.length));
  return pairs.map(([label, value, role = "strong"]) => [["label", label.padEnd(named)], ["", "  "], [role, value]]);
};

// Decision time in numbers.
export function timingFacts({ stats }) {
  const total = (stats.decide_hist?.counts ?? []).reduce((sum, c) => sum + num(c), 0);
  const under = underOf(stats);
  return facts([
    ["decisions", count(total)],
    ["mean", total ? nanos(num(stats.decide_ns) / total) : "none yet"],
    ["p50", under(0.5)],
    ["p90", under(0.9)],
    ["p99", under(0.99), "value"],
    ["time deciding", nanos(num(stats.decide_ns))],
    ["scanned", bytes(num(stats.scanned_bytes))],
    ["per decision", total ? bytes(Math.round(num(stats.scanned_bytes) / total)) : "none yet"],
  ]);
}

// What takes longest to decide: the rules, and a clean pass, by mean time.
export function slowest(view, width) {
  const clean = unmatchedOf(view.stats);
  const timed = [...rulesOf(view).map((r) => ({ name: r.name, runs: num(r.timing?.runs), ns: num(r.timing?.ns) })), { name: "matched no rule", ...clean }]
    .map((r) => ({ ...r, mean: r.runs > 0 ? r.ns / r.runs : 0 }))
    .filter((r) => r.runs > 0)
    .sort((a, b) => b.mean - a.mean);
  if (timed.length === 0) return [[["note", "nothing timed yet"]]];

  const most = Math.max(...timed.map((r) => r.mean));
  const named = Math.max(...timed.map((r) => r.name.length));
  const means = Math.max(...timed.map((r) => nanos(r.mean).length));
  return timed.map((r) => [
    ["name", r.name.padEnd(named)], ["", NBSP], ["value", nanos(r.mean).padStart(means)], ["", NBSP],
    ...meter(heat(r.mean / most * 0.999), r.mean / most, Math.max(4, width - named - means - 3)),
  ]);
}

// The picked rule, in numbers, with its share of the hits as a meter.
export function ruleDetail(view, rule, width) {
  const total = rulesOf(view).reduce((sum, r) => sum + r.hits, 0);
  return [
    ...facts([
      ["hits", count(rule.hits)],
      ["share", percent(rule.hits, total) || "none yet"],
      ["rate", perSecond(view.ruleSpeeds?.[rule.id]), "ok"],
      ["timed", count(num(rule.timing?.runs))],
      ["mean", meanOf(rule) || "none yet", "value"],
      ["total", nanos(num(rule.timing?.ns)), "value"],
    ]),
    [["", ""]],
    meter(heat(0.2), total ? rule.hits / total : 0, Math.max(4, width)),
  ];
}

// Every counter the VM keeps, by what it is about.
const GROUPS = [
  ["packets", ["seen", "ran", "passed", "dropped", "rsts", "bans", "shadowed", "faults"]],
  ["standing", ["enforced", "src_enforced", "shadow_enforced", "nat_reversed"]],
  ["inspection", ["scanned_bytes", "flows_created", "decide_ns"]],
  ["events", ["logged", "sampled", "ring_full"]],
  ["reassembly", ["reasm_retrans", "reasm_midjoin", "reasm_held", "reasm_slid", "reasm_over", "reasm_trunc"]],
  ["http/2", ["h2_blocks", "h2_raw", "h2_unresolved", "h2_trunc", "h2_failed"]],
];
const UNITS = { scanned_bytes: bytes, decide_ns: nanos };
const NAMES = { decide_ns: "time deciding", scanned_bytes: "scanned", src_enforced: "by source ban", enforced: "by flow verdict", shadow_enforced: "passed in shadow", reasm_trunc: "partly read" };
const TROUBLE = new Set(["faults", "ring_full", "reasm_over", "reasm_trunc", "h2_failed"]);

const GROUP_WIDTH = 24;

// One group as a block: its heading, then a counter a row, `width` cells wide.
function block([title, keys], stats, width) {
  const present = keys.filter((key) => stats[key] !== undefined);
  if (present.length === 0) return null;
  return [
    [["frame", `── ${title} ${"─".repeat(Math.max(0, width - title.length - 4))}`]],
    ...present.map((key) => {
      const moved = num(stats[key]) > 0;
      const name = NAMES[key] ?? key.replace(/^(reasm|h2)_/, "").replaceAll("_", " ");
      const value = (UNITS[key] ?? count)(num(stats[key]));
      return [
        [moved ? "label" : "frame", name.padEnd(Math.max(0, width - value.length))],
        [!moved ? "frame" : TROUBLE.has(key) ? "bad" : "strong", value],
      ];
    }),
  ];
}

/* Every counter, the groups side by side as many as fit and the rest in
 * bands below, so a wide box is filled and a narrow one is a single list.
 * The counters that have moved stand out.
 */
export function counters({ stats }, width) {
  const across = Math.max(1, Math.floor((width + 2) / (GROUP_WIDTH + 2)));
  const each = Math.floor((width - (across - 1) * 2) / across);
  const blocks = GROUPS.map((group) => block(group, stats, each)).filter(Boolean);

  const rows = [];
  for (let i = 0; i < blocks.length; i += across) {
    const band = blocks.slice(i, i + across);
    const tall = Math.max(...band.map((b) => b.length));
    for (let row = 0; row < tall; row++) {
      rows.push(band.flatMap((b, col) => [...(col > 0 ? [["", "  "]] : []), ...(b[row] ?? [["", " ".repeat(each)]])]));
    }
  }
  return rows;
}
