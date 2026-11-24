/* `PfwVm.stats()` as the page `pfwctl metrics` prints: where the packets
 * went, which rules took them, how long deciding took, and whatever else
 * the VM counted.
 */
import { bytes, count, nanos } from "#/ctl/render/format.js";
import { cell, table } from "#/ctl/render/table.js";

const BAR_WIDTH = 24;
const EIGHTHS = " ▏▎▍▌▋▊▉█";
// The slot pfw-core counts packets that ended on no rule under.
const NO_RULE = "-";

const VERDICTS = [["pass", "passed"], ["drop", "dropped"], ["rst", "rsts"], ["ban", "bans"]];
// Shown in their own sections, or as the unit of another counter.
const ELSEWHERE = new Set(["seen", "passed", "dropped", "rsts", "bans", "decide_ns"]);
const AS_BYTES = new Set(["scanned_bytes"]);

const num = (v) => Number(v ?? 0);

// `fraction` of the bar's width, to an eighth of a cell.
function bar(fraction) {
  const eighths = Math.round(Math.min(1, Math.max(0, fraction)) * BAR_WIDTH * 8);
  const partial = eighths % 8;
  return "█".repeat(Math.floor(eighths / 8)) + (partial ? EIGHTHS[partial] : "");
}

const percent = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(part > 0 && part / whole < 0.001 ? 2 : 1)}%` : "");

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

function rules(stats, p) {
  const rows = Object.entries(stats.rules ?? {})
    .map(([name, hits]) => ({ name, hits: num(hits), timing: stats.timing?.[name] }))
    .sort((a, b) => b.hits - a.hits);
  if (rows.length === 0) return [];

  const most = Math.max(1, ...rows.map((r) => r.hits));
  return [
    `${p.label("rules")}  ${p.note("hits, mean decision time")}`,
    ...table(rows.map(({ name, hits, timing }) => {
      const runs = num(timing?.runs);
      return [
        cell(p.name, name === NO_RULE ? "(no rule)" : name),
        cell(p.value, count(hits)),
        cell(p.note, runs > 0 ? nanos(num(timing.ns) / runs) : ""),
        cell(p.value, bar(hits / most)),
      ];
    })),
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
    `${p.label("decision time")}  ${p.note(`mean ${nanos(num(stats.decide_ns) / total)} over ${count(total)}`)}`,
    ...table(rows.map((r) => [cell(p.name, r.label), cell(p.value, count(r.n)), cell(p.note, percent(r.n, total)), cell(p.value, bar(r.n / most))])),
  ];
}

// Every other counter that has counted something.
function engine(stats, p) {
  const rows = Object.entries(stats)
    .filter(([key, v]) => typeof v === "bigint" && !ELSEWHERE.has(key) && v > 0n)
    .map(([key, v]) => [cell(p.name, key.replaceAll("_", " ")), cell(key === "faults" ? p.bad : p.value, AS_BYTES.has(key) ? bytes(v) : count(v))]);
  return rows.length ? [p.label("engine"), ...table(rows)] : [];
}

export function metrics({ attached, stats }, p) {
  if (!attached) return p.warn("attached to no interface: nothing is counted");

  return [packets, rules, decisions, engine]
    .map((section) => section(stats, p))
    .filter((lines) => lines.length > 0)
    .map((lines) => lines.join("\n"))
    .join("\n\n");
}
