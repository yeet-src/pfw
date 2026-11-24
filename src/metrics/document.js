/* The firewall's state as a `yeet:telemetry` document. Pure: it takes what
 * `Firewall.status()` and `Firewall.stats()` return and builds the object
 * the Prometheus encoder renders, so it is tested without a kernel.
 */
import { by, counter, gauge, histogram } from "yeet:telemetry";

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
      policy: {
        enforcing: gauge({ help: "1 while a policy is enforcing.", value: policy !== null }),
        info: policy && gauge({ help: "The policy now enforcing.", value: [[{ name: policy.name }, 1]] }),
        applied_timestamp_seconds: policy && gauge({
          help: "When the policy now enforcing was applied.",
          value: policy.applied_at / 1000,
        }),
      },
      packets_seen_total: counter({ help: "Packets that reached the XDP hook.", value: stats.seen }),
      packets_total: counter({ help: "Packets the policy decided, by verdict.", value: verdicts(stats) }),
      scanned_bytes_total: counter({ help: "Payload bytes the matcher read.", value: stats.scanned_bytes }),
      faults_total: counter({ help: "Program runs that faulted.", value: stats.faults }),
      flows_created_total: counter({ help: "Connections the firewall started tracking.", value: stats.flows_created }),
      rule_hits_total: counter({
        help: "Packets that ended on each rule, since its policy was applied.",
        value: by("rule", stats.rules),
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
