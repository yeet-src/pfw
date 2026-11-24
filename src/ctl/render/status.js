/* `Firewall.report()` as the block `pfw status` prints. */
import { count, duration, plural, splitName } from "#/ctl/render/format.js";
import { shown } from "#/ctl/render/knobs.js";

const TOP_RULES = 8;
// The slot pfw-core counts packets that ended on no rule under.
const NO_RULE = "-";

const row = (p, label, text) => `  ${p.label(label.padEnd(9))}${text}`;

function policyName(p, name) {
  const { source, rev } = splitName(name);
  return rev ? `${p.name(source)} ${p.note("@")} ${p.value(rev)}` : p.name(source);
}

function policyRow(p, report, now) {
  if (!report.policy) return row(p, "policy", p.warn("none: passing everything"));
  const mode = report.interfaces.length === 0
    ? p.warn("held: no interface to enforce on")
    : report.shadow ? p.warn("shadow (dry run)") : p.ok("enforcing");
  const applied = p.note(`applied ${duration(now - report.policy.applied_at)} ago`);
  return row(p, "policy", `${policyName(p, report.policy.name)}   ${mode}   ${applied}`);
}

// A blocking verdict stands out once it has happened.
const tally = (p, label, n) => `${p.label(label)} ${Number(n) > 0 ? p.warn(count(n)) : p.value(count(n))}`;

// The knobs set for the enforcing policy; ones left at their default say nothing.
function knobsRow(p, policy) {
  const set = (policy?.knobs ?? []).filter((k) => k.set);
  if (set.length === 0) return null;
  return row(p, "knobs", set.map((k) => `${p.name(k.name)} ${p.strong(shown(k))}`).join("   "));
}

// A change waiting to be confirmed, or one that was not and has gone back.
function trialRow(p, { trial, lapsed_at }, now) {
  if (trial) return row(p, "trial", `${p.warn(`undone in ${duration(trial.until - now)}`)}   ${p.note("pfw confirm keeps it, pfw rollback undoes it now")}`);
  if (lapsed_at) return row(p, "trial", p.warn(`not confirmed: went back ${duration(now - lapsed_at)} ago`));
  return null;
}

function packetsRow(p, { counters, shadow, shadowed }) {
  return row(p, "packets", [
    `${p.strong(count(counters.seen))} ${p.label("seen")}`,
    `${p.label("pass")} ${p.ok(count(counters.passed))}`,
    tally(p, "drop", counters.dropped),
    tally(p, "rst", counters.rsts),
    tally(p, "ban", counters.bans),
    // In a dry run, the count that matters: what would have been blocked.
    shadow && `${p.label("would block")} ${p.warn(count(shadowed))}`,
  ].filter(Boolean).join("   "));
}

function rulesRow(p, rules) {
  const hits = Object.entries(rules ?? {})
    .filter(([name]) => name !== NO_RULE)
    .sort(([, a], [, b]) => Number(b) - Number(a));
  if (hits.length === 0) return null;

  const shown = hits.slice(0, TOP_RULES).map(([name, n]) => `${p.name(name)} ${p.value(count(n))}`);
  const more = hits.length > TOP_RULES ? [p.note(`+${hits.length - TOP_RULES} more`)] : [];
  return row(p, "rules", [...shown, ...more].join("   "));
}

export function status(report, p, now = Date.now()) {
  const state = report.running
    ? `${p.ok("●")} ${p.strong("pfw")}  ${p.ok("up")} ${p.value(duration(now - report.started_at))}`
    : `${p.bad("●")} ${p.strong("pfw")}  ${p.bad("down")}`;
  const interfaces = report.interfaces.length > 0
    ? report.interfaces.map((i) => p.name(i.name)).join(p.note(", "))
    : p.warn("no interface: nothing is filtered");

  const dryRun = report.shadow ? `   ${p.warn("shadow mode: nothing is blocked")}` : "";

  return [
    `${state}   ${p.label("on")} ${interfaces}${dryRun}`,
    policyRow(p, report, now),
    trialRow(p, report, now),
    knobsRow(p, report.policy),
    packetsRow(p, report),
    rulesRow(p, report.rules),
    Number(report.counters.faults) > 0 && row(p, "faults", p.bad(plural(Number(report.counters.faults), "program fault"))),
  ].filter(Boolean).join("\n");
}
