/* The host's interfaces as `pfw interfaces` lists them: which pfw is on,
 * what each one is, and which to attach to. The one the default route goes
 * through is where traffic from the network arrives, which is the answer to
 * the question most people are asking.
 */
import { cell, table } from "#/ctl/render/table.js";

// What an interface is for, in the order it matters to someone choosing.
function about(p, i, { defaults, busy }, isAttached) {
  if (busy.includes(i.name) && !isAttached) return cell(p.bad, "another XDP program is on it: pfw cannot attach here");
  if (defaults.includes(i.name)) return cell(p.ok, "default route: traffic from the network arrives here");
  if (i.loopback) return cell(p.note, "loopback: this machine talking to itself");
  if (!i.up) return cell(p.note, "down: nothing arrives here");
  return cell(p.note, "");
}

export function interfaces({ available, attached, defaults = [], busy = [] }, p) {
  const rows = available.map((i) => {
    const isAttached = attached.includes(i.name);
    return [
      cell(p.ok, isAttached ? "▸" : " "),
      cell(isAttached ? p.strong : p.name, i.name),
      cell(i.up ? p.value : p.warn, i.up ? "up" : "down"),
      cell(p.value, (i.addresses ?? []).join(" ")),
      cell(isAttached ? p.ok : p.note, isAttached ? "attached" : ""),
      about(p, i, { defaults, busy }, isAttached),
    ];
  });

  // What to do next, when the interface that matters is not the one pfw is on.
  const wanted = defaults.filter((name) => !attached.includes(name) && !busy.includes(name));
  const hint = wanted.length > 0
    ? ["", `${p.label("to filter traffic from the network:")} ${p.strong(`pfw attach ${wanted.join(" ")}`)}`]
    : [];

  return [...table(rows, ""), ...hint].join("\n");
}
