/* `Firewall.report()` as the block `pfw status` prints. */
import { count, duration, plural, splitName } from "#/ctl/render/format.js";
import { shown } from "#/ctl/render/knobs.js";
import { ruleCounts } from "#/fw/counted.js";

const TOP_RULES = 8;

const row = (p, label, text) => `  ${p.label(label.padEnd(9))}${text}`;

function policyName(p, name) {
  const { source, rev } = splitName(name);
  return rev ? `${p.name(source)} ${p.note("@")} ${p.value(rev)}` : p.name(source);
}

/* A row for every policy in place: the default as `policy`, then the chain
 * run first in its order, then each route with the packets it is for.
 */
function policyRows(p, report, now) {
  if (report.policies.length === 0) return [row(p, "policy", p.warn("none: passing everything"))];

  const mode = report.interfaces.length === 0
    ? p.warn("held: no interface to enforce on")
    : report.shadow ? p.warn("shadow (dry run)") : p.ok("enforcing");
  const rows = report.policies.map((policy) => {
    const applied = p.note(`applied ${duration(now - policy.applied_at)} ago`);
    const what = `${policyName(p, policy.name)}   ${mode}   ${applied}`;
    return policy.place === "route" ? row(p, "route", `${p.value(policy.at)}  ${what}`) : row(p, policy.place === "first" ? "first" : "policy", what);
  });

  return report.policy ? rows : [row(p, "policy", p.warn("none by default: what no route claims passes")), ...rows];
}

// A blocking verdict stands out once it has happened.
const tally = (p, label, n) => `${p.label(label)} ${Number(n) > 0 ? p.warn(count(n)) : p.value(count(n))}`;

// The knobs set for the policies in place; ones left at their default say
// nothing. With several policies in place, each knob says whose it is.
function knobsRow(p, policies) {
  const owners = new Map(policies.map((policy) => [splitName(policy.name).source, policy]));
  const set = [...owners].flatMap(([owner, policy]) => policy.knobs.filter((k) => k.set).map((k) => ({ ...k, owner })));
  if (set.length === 0) return null;

  const whose = (k) => (owners.size > 1 ? ` ${p.note(`(${k.owner})`)}` : "");
  return row(p, "knobs", set.map((k) => `${p.name(k.name)} ${p.strong(shown(k))}${whose(k)}`).join("   "));
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
    // Not a fourth kind of packet: the senders banned, each of them by a
    // packet that is counted as a drop.
    tally(p, "ban", counters.bans),
    // In a dry run, the count that matters: what would have been blocked.
    shadow && `${p.label("would block")} ${p.warn(count(shadowed))}`,
  ].filter(Boolean).join("   "));
}

// The times each rule decided, the busiest first, whichever policy's it is.
function rulesRow(p, report) {
  const hits = ruleCounts(report);
  if (hits.length === 0) return null;

  const shown = hits.slice(0, TOP_RULES).map((rule) => `${p.name(rule.name)} ${p.value(count(rule.hits))}`);
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
    ...policyRows(p, report, now),
    trialRow(p, report, now),
    knobsRow(p, report.policies),
    packetsRow(p, report),
    rulesRow(p, report),
    Number(report.counters.faults) > 0 && row(p, "faults", p.bad(plural(Number(report.counters.faults), "program fault"))),
  ].filter(Boolean).join("\n");
}
