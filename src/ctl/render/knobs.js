/* A policy's knobs as `pfwctl knob ls` prints them: what each holds now,
 * whether that was set or is the policy's default, and what it is for.
 */
import { splitName } from "#/ctl/render/format.js";
import { cell, table } from "#/ctl/render/table.js";

export const shown = (knob) => (knob.kind === "string" ? JSON.stringify(knob.value) : String(knob.value));
const shownDefault = (knob) => (knob.kind === "string" ? JSON.stringify(knob.default) : String(knob.default));

export function knobs({ policy, state, knobs: list }, p) {
  const { source, rev } = splitName(policy);
  const where = state === "enforcing" ? p.ok("enforcing") : p.note("not enforcing");
  const head = `${p.label("knobs of")} ${p.name(source)}${rev ? ` ${p.note("@")} ${p.value(rev)}` : ""}   ${where}`;
  if (list.length === 0) return `${head}\n  ${p.note("this policy declares none")}`;

  return [
    head,
    ...table(list.map((knob) => [
      cell(p.name, knob.name),
      cell(knob.set ? p.strong : p.value, shown(knob)),
      cell(knob.set ? p.warn : p.note, knob.set ? `set, default ${shownDefault(knob)}` : "default"),
      cell(p.note, knob.about ?? ""),
    ])),
  ].join("\n");
}
