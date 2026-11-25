/* The firewall's state as a `yeet:telemetry` document. Pure: it takes what
 * `Firewall.status()` and `Firewall.stats()` return and builds the object
 * the Prometheus encoder renders, so it is tested without a kernel.
 */
import { counter, gauge, histogram } from "yeet:telemetry";

import { splitName } from "#/fw/name.js";

// How a packet's run ended, by the `PfwVm.stats()` counter that tallies it.
// Every packet is in exactly one. A `ban` drops, and is counted there.
const VERDICTS = { pass: "passed", drop: "dropped", rst: "rsts" };

const verdicts = (stats) =>
  Object.entries(VERDICTS).map(([verdict, key]) => [{ verdict }, stats[key] ?? 0n]);

/* `decide_hist.counts[i]` is the decisions under `bounds[i]` ns, with one
 * more count past the last bound; Prometheus wants them cumulative.
 */
function decideBuckets({ bounds = [], counts = [] } = {}) {
  let total = 0n;
  const buckets = bounds.map((le, i) => [le, (total += BigInt(counts[i] ?? 0))]);
  total += BigInt(counts[bounds.length] ?? 0);
  return { buckets, count: total };
}

// Labelled samples for the counters in `kinds` that this VM reports.
const kinds = (label, stats, names) =>
  Object.entries(names).filter(([, key]) => stats[key] !== undefined).map(([kind, key]) => [{ [label]: kind }, stats[key]]);

// What reassembly did with a segment it could not simply append.
const REASSEMBLY = { retransmit: "reasm_retrans", mid_join: "reasm_midjoin", held: "reasm_held", slid: "reasm_slid", oversize: "reasm_over", truncated: "reasm_trunc" };
// What the HTTP/2 decoder made of a connection's header blocks.
const H2 = { decoded: "h2_blocks", not_h2: "h2_raw", unresolved: "h2_unresolved", truncated: "h2_trunc", failed: "h2_failed" };
const STANDING = { flow: "enforced", source: "src_enforced" };

// A policy's labels: where it is, its name, and what it says about itself.
function policyLabels(policy) {
  const { rev } = splitName(policy.name);
  const { severity, cves = [] } = policy.meta ?? {};
  return {
    route: policy.at,
    name: policy.name,
    ...(rev && { rev }),
    ...(severity && { severity }),
    ...(cves.length > 0 && { cve: cves.join(",") }),
  };
}

// A string knob is not a number, so only the numeric ones are gauges. A
// policy in two places has its knobs once.
const knobValues = (policies) => [...new Map(policies.flatMap((policy) =>
  (policy.knobs ?? []).filter((k) => k.kind === "number").map((k) => {
    const labels = { policy: splitName(policy.name).source, knob: k.name };
    return [`${labels.policy} ${labels.knob}`, [labels, k.value]];
  }))).values()];

// One sample for every rule of every policy in place, by where it is.
const perRule = (programs, read) =>
  programs.flatMap((program) => Object.entries(read(program) ?? {}).map(([rule, value]) => [{ route: program.at, rule }, value]));

export function document(status, stats) {
  const { policies } = status;
  const programs = stats.programs ?? [];
  const some = policies.length > 0;
  const decide = decideBuckets(stats.decide_hist);

  return {
    pfw: {
      up: gauge({ help: "1 while the firewall is attached to an interface.", value: status.interfaces.length > 0 }),
      interface_info: gauge({
        help: "The interfaces the firewall is attached to.",
        value: status.interfaces.map((i) => [{ interface: i.name, ifindex: String(i.index) }, 1]),
      }),
      shadow: gauge({ help: "1 while enforcement is a dry run.", value: stats.shadow }),
      trial_pending: gauge({ help: "1 while a change waits to be confirmed, and is undone if it is not.", value: Boolean(status.on_trial) }),
      policy: {
        enforcing: gauge({ help: "1 while a policy is enforcing.", value: some }),
        info: some ? gauge({
          help: "The policies now enforcing. `route` is where each is: default, first and first.N down the chain run first, or the packets a route is for.",
          value: policies.map((policy) => [policyLabels(policy), 1]),
        }) : null,
        applied_timestamp_seconds: some ? gauge({
          help: "When each policy now enforcing was applied.",
          value: policies.map((policy) => [{ route: policy.at }, policy.applied_at / 1000]),
        }) : null,
      },
      knob: some ? gauge({ help: "The numeric knobs of the policies enforcing, as they are set.", value: knobValues(policies) }) : null,

      packets_seen_total: counter({ help: "Packets that reached the XDP hook.", value: stats.seen }),
      packets_total: counter({ help: "Packets decided, by verdict.", value: verdicts(stats) }),
      bans_total: counter({ help: "`ban` verdicts decided. The packet of each is a drop, and is counted as one.", value: stats.bans }),
      program_runs_total: counter({ help: "Packets a policy's program ran on.", value: stats.ran }),
      shadowed_total: counter({ help: "Blocking verdicts shadow mode let through.", value: stats.shadowed }),
      shadow_standing_packets_total: counter({
        help: "Packets a verdict already standing would have stopped, passed because of shadow mode.",
        value: stats.shadow_enforced,
      }),
      standing_verdict_packets_total: counter({
        help: "Packets decided by a verdict already standing on their flow or their source.",
        value: kinds("scope", stats, STANDING),
      }),
      scanned_bytes_total: counter({ help: "Payload bytes the matcher read.", value: stats.scanned_bytes }),
      faults_total: counter({ help: "Program runs that faulted.", value: stats.faults }),
      flows_created_total: counter({ help: "Connections the firewall started tracking.", value: stats.flows_created }),
      nat_reversed_total: counter({ help: "Reply packets whose source a dnat's reverse path restored.", value: stats.nat_reversed }),

      events_logged_total: counter({ help: "Events sent to the host.", value: stats.logged }),
      events_dropped_total: counter({ help: "Events lost because the ring to the host was full.", value: stats.ring_full }),
      frames_sampled_total: counter({ help: "Frames copied to the host as samples.", value: stats.sampled }),

      reassembly_total: counter({
        help: "TCP segments reassembly could not simply append, by what became of them. `mid_join`, `oversize` and `truncated` are payload it did not fully inspect.",
        value: kinds("event", stats, REASSEMBLY),
      }),
      h2_total: counter({
        help: "HTTP/2 header blocks, by what the decoder made of them. `unresolved`, `truncated` and `failed` are headers it did not fully see.",
        value: kinds("event", stats, H2),
      }),

      rule_hits_total: counter({
        help: "Times each rule decided, since its policy was applied. `route` is where the policy is.",
        value: perRule(programs, (program) => program.rules),
      }),
      rule_standing_packets_total: counter({
        help: "Packets stopped by a verdict a rule left standing: a dropped connection's retransmissions, what a banned sender goes on to send.",
        value: perRule(programs, (program) => program.enforced_rules),
      }),
      rule_runs_total: counter({
        help: "Decisions timed, by the rule they ended on.",
        value: perRule(programs, (program) => Object.fromEntries(Object.entries(program.timing).map(([rule, t]) => [rule, t.runs]))),
      }),
      rule_decide_nanoseconds_total: counter({
        help: "Time spent deciding, by the rule the decision ended on.",
        value: perRule(programs, (program) => Object.fromEntries(Object.entries(program.timing).map(([rule, t]) => [rule, t.ns]))),
      }),
      decide_duration_nanoseconds: histogram({
        help: "How long a packet's decision took.",
        buckets: decide.buckets,
        count: decide.count,
        sum: stats.decide_ns,
      }),
    },
  };
}
