/* The firewall's state as a `yeet:telemetry` document. Pure: it takes what
 * `Firewall.status()` and `Firewall.stats()` return and builds the object
 * the Prometheus encoder renders, so it is tested without a kernel.
 */
import { by, counter, gauge, histogram } from "yeet:telemetry";

import { splitName } from "#/fw/name.js";

// How a packet's run ended, by the `PfwVm.stats()` counter that tallies it.
const VERDICTS = { pass: "passed", drop: "dropped", rst: "rsts", ban: "bans" };

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

// The enforcing policy's labels: its name, and what it says about itself.
function policyLabels(policy) {
  const { rev } = splitName(policy.name);
  const { severity, cves = [] } = policy.meta ?? {};
  return {
    name: policy.name,
    ...(rev && { rev }),
    ...(severity && { severity }),
    ...(cves.length > 0 && { cve: cves.join(",") }),
  };
}

// A string knob is not a number, so only the numeric ones are gauges.
const knobValues = (policy) =>
  (policy.knobs ?? []).filter((k) => k.kind === "number").map((k) => [{ policy: splitName(policy.name).source, knob: k.name }, k.value]);

const perRule = (timing, field) => Object.entries(timing ?? {}).map(([rule, t]) => [{ rule }, t[field]]);

export function document(status, stats) {
  const policy = status.policy;
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
        enforcing: gauge({ help: "1 while a policy is enforcing.", value: policy !== null }),
        info: policy && gauge({ help: "The policy now enforcing.", value: [[policyLabels(policy), 1]] }),
        applied_timestamp_seconds: policy && gauge({
          help: "When the policy now enforcing was applied.",
          value: policy.applied_at / 1000,
        }),
      },
      knob: policy && gauge({ help: "The enforcing policy's numeric knobs, as they are set.", value: knobValues(policy) }),

      packets_seen_total: counter({ help: "Packets that reached the XDP hook.", value: stats.seen }),
      packets_total: counter({ help: "Packets the policy decided, by verdict.", value: verdicts(stats) }),
      program_runs_total: counter({ help: "Packets the policy's program ran on.", value: stats.ran }),
      shadowed_total: counter({ help: "Packets a verdict would have blocked, passed because of shadow mode.", value: stats.shadowed }),
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
        help: "Packets that ended on each rule, since its policy was applied.",
        value: by("rule", stats.rules),
      }),
      rule_runs_total: counter({ help: "Decisions timed, by the rule they ended on.", value: perRule(stats.timing, "runs") }),
      rule_decide_nanoseconds_total: counter({ help: "Time spent deciding, by the rule the decision ended on.", value: perRule(stats.timing, "ns") }),
      decide_duration_nanoseconds: histogram({
        help: "How long a packet's decision took.",
        buckets: decide.buckets,
        count: decide.count,
        sum: stats.decide_ns,
      }),
    },
  };
}
