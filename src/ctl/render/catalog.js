/* Checked policies as the numbered list `pfw ls` prints and `pfw
 * apply` picks from: whether each compiles, and which one is enforcing.
 */
import { plural, splitName } from "#/ctl/render/format.js";
import { shown } from "#/ctl/render/knobs.js";
import { cell, table } from "#/ctl/render/table.js";

function detail(p, entry, active) {
  if (!entry.ok) return p.bad(entry.errors.map((e) => (e.line ? `line ${e.line}: ` : "") + e.text).join("; "));

  const rules = p.note(plural(entry.rules.length, "rule"));
  if (!active) return rules;
  const here = splitName(entry.name).rev;
  const running = splitName(active).rev;
  return here === running
    ? `${rules}   ${p.ok("active")}`
    : `${rules}   ${p.warn(`active at ${running}, this is ${here}`)}`;
}

const SEVERITY_TONE = { critical: "bad", high: "bad", medium: "warn", low: "note" };

// What the policy says about itself, as the lines under its row.
function about(p, { meta, knobs = [] }) {
  if (!meta) return [];
  const facts = [
    ...meta.cves.map((cve) => p.warn(cve)),
    meta.severity && p[SEVERITY_TONE[meta.severity] ?? "note"](meta.severity),
    meta.patches && `${p.label("patches")} ${p.value(meta.patches)}`,
    ...meta.tags.map((tag) => p.tag(`#${tag}`)),
  ].filter(Boolean);

  return [
    meta.description && p.note(meta.description),
    facts.length > 0 && facts.join("  "),
    ...dials(p, knobs),
  ].filter(Boolean);
}

/* A line per knob: what it holds, whether that was set for this policy, and
 * what it is for. The column saying so is there only when one was set.
 */
function dials(p, knobs) {
  if (knobs.length === 0) return [];
  const anySet = knobs.some((k) => k.set);

  return table(knobs.map((k) => [
    cell(p.label, "knob"),
    cell(p.name, k.name),
    cell(k.set ? p.strong : p.value, shown(k)),
    ...(anySet ? [cell(p.warn, k.set ? "set" : "")] : []),
    cell(p.note, k.about ?? ""),
  ]), "");
}

export function catalog({ entries, active, first = 1 }, p) {
  if (entries.length === 0) return p.warn("no policies: pfw remote add NAME URL, then pfw pull");

  const activeSource = active ? splitName(active).source : null;
  const width = Math.max(...entries.map((e) => splitName(e.name).source.length));
  const digits = String(first + entries.length - 1).length;
  // Under the name: past the marker, the number and the tick.
  const indent = " ".repeat(digits + 5);

  return entries.flatMap((entry, i) => {
    const { source } = splitName(entry.name);
    const isActive = source === activeSource;
    const row = [
      isActive ? p.ok("▸") : " ",
      p.label(String(first + i).padStart(digits)),
      entry.ok ? p.ok("✔") : p.bad("✘"),
      (isActive ? p.strong : p.name)(source.padEnd(width)),
      ` ${detail(p, entry, isActive ? active : null)}`,
    ].join(" ");
    return [row, ...about(p, entry).map((line) => `${indent}${line}`)];
  }).join("\n");
}
