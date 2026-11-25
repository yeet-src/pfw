/* A policy's knobs as `pfw knob ls` prints them: what each holds now,
 * whether that was set or is the policy's default, and what it is for.
 */
import { splitName } from "#/ctl/render/format.js";
import { cell, table } from "#/ctl/render/table.js";

export const shown = (knob) => (knob.kind === "string" ? JSON.stringify(knob.value) : String(knob.value));
const shownDefault = (knob) => (knob.kind === "string" ? JSON.stringify(knob.default) : String(knob.default));

// Where a policy in place is, unless that is only the default.
const places = (at, p) => (at.length === 0 || (at.length === 1 && at[0] === "default") ? "" : `   ${p.value(at.join(", "))}`);

export function knobs({ policies, ...one }, p) {
  return (policies ?? [one]).map((each) => block(each, p)).join("\n");
}

function block({ policy, state, at = [], knobs: list }, p) {
  const { source, rev } = splitName(policy);
  const where = state === "enforcing" ? `${p.ok("enforcing")}${places(at, p)}` : p.note("not enforcing");
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
