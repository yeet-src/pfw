/* The policies as the numbered list `pfw ls` prints and `pfw apply` picks
 * from, and which one is enforcing. Checked (`pfw ls --check`), each also
 * says whether it compiles and how many rules it has.
 */
import { plural, splitName } from "#/ctl/render/format.js";
import { shown } from "#/ctl/render/knobs.js";
import { cell, table } from "#/ctl/render/table.js";

function detail(p, entry, active) {
  if (!entry.ok) return p.bad(entry.errors.map((e) => (e.line ? `line ${e.line}: ` : "") + e.text).join("; "));

  // Not compiled, so there are no rules to count.
  const rules = entry.checked === false ? "" : p.note(plural(entry.rules.length, "rule"));
  if (!active) return rules;
  const here = splitName(entry.name).rev;
  const running = splitName(active).rev;
  const state = here === running ? p.ok("active") : p.warn(`active at ${running}, this is ${here}`);
  return rules ? `${rules}   ${state}` : state;
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
    // A knob read from the comments alone has a purpose and no value yet.
    cell(k.set ? p.strong : p.value, k.unread ? "" : shown(k)),
    ...(anySet ? [cell(p.warn, k.set ? "set" : "")] : []),
    cell(p.note, k.about ?? ""),
  ]), "");
}

// A policy's group: the directory it is in, which is what it shields.
function groupOf(name) {
  const { source } = splitName(name);
  const [remote, path = ""] = source.includes(":") ? source.split(/:(.*)/s) : ["", source];
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return { remote, directory };
}

/* The list in groups, a heading a directory. The numbers are the policies'
 * places in the whole list, so they hold when the list is filtered.
 */
export function catalog({ entries, active, total = entries.length, filtered = false, checked = true }, p) {
  if (total === 0) return p.warn("no policies: pfw remote add NAME URL, then pfw pull");
  if (entries.length === 0) return p.warn(`none of the ${total} policies match`);

  const activeSource = active ? splitName(active).source : null;
  const width = Math.max(...entries.map((e) => splitName(e.name).source.length));
  const digits = String(Math.max(...entries.map((e, i) => e.number ?? i + 1))).length;
  // Under the name: past the marker, the number and the tick.
  const indent = " ".repeat(digits + 5);
  const remotes = new Set(entries.map((e) => groupOf(e.name).remote));

  const lines = [];
  let heading = null;
  entries.forEach((entry, i) => {
    const { remote, directory } = groupOf(entry.name);
    // The remote is named in a heading only when there is more than one.
    const title = [remotes.size > 1 ? remote : "", directory].filter(Boolean).join(" · ");
    if (title !== heading) {
      if (lines.length > 0) lines.push("");
      if (title) lines.push(p.label(title));
      heading = title;
    }

    const { source } = splitName(entry.name);
    const isActive = source === activeSource;
    lines.push([
      isActive ? p.ok("▸") : " ",
      p.label(String(entry.number ?? i + 1).padStart(digits)),
      entry.checked === false ? " " : entry.ok ? p.ok("✔") : p.bad("✘"),
      (isActive ? p.strong : p.name)(source.padEnd(width)),
      ` ${detail(p, entry, isActive ? active : null)}`,
    ].join(" "));
    lines.push(...about(p, entry).map((line) => `${indent}${line}`));
  });

  if (filtered) lines.push("", p.note(`${entries.length} of ${total} policies`));
  if (!checked) lines.push("", p.note("not compiled: pfw ls --check says whether each one is sound, and pfw apply checks the one it is given"));
  return lines.join("\n");
}
