import { assert } from "yeet:assert";
import { render } from "yeet:telemetry";

import { document } from "#/metrics/document.js";

const { test } = yeet;

const STATUS = {
  running: true,
  interfaces: [{ name: "lo", index: 1 }],
  policy: { name: "crawlers.pfc@abc1234", bytes: 120, rules: ["crawler"], applied_at: 1_700_000_000_000 },
};

const STATS = {
  shadow: false,
  seen: 10n,
  passed: 7n,
  dropped: 1n,
  rsts: 2n,
  bans: 0n,
  scanned_bytes: 4096n,
  faults: 0n,
  flows_created: 3n,
  decide_ns: 5000n,
  rules: { crawler: 2n },
  decide_hist: { bounds: [100, 1000], counts: [4n, 5n, 1n] },
};

test("a loaded policy renders its counters by verdict and rule", async () => {
  const text = await render(document(STATUS, STATS));

  assert(text.includes("pfw_up 1"));
  assert(text.includes('pfw_policy_info{name="crawlers.pfc@abc1234"} 1'));
  assert(text.includes('pfw_packets_total{verdict="rst"} 2'));
  assert(text.includes('pfw_rule_hits_total{rule="crawler"} 2'));
});

test("decide buckets are cumulative and end at the total", async () => {
  const text = await render(document(STATUS, STATS));

  assert(text.includes('pfw_decide_duration_nanoseconds_bucket{le="100"} 4'));
  assert(text.includes('pfw_decide_duration_nanoseconds_bucket{le="1000"} 9'));
  assert(text.includes('pfw_decide_duration_nanoseconds_bucket{le="+Inf"} 10'));
  assert(text.includes("pfw_decide_duration_nanoseconds_sum 5000"));
});

test("no policy leaves the policy series out", async () => {
  const text = await render(document({ ...STATUS, policy: null }, { ...STATS, rules: {} }));

  assert(text.includes("pfw_policy_enforcing 0"));
  assert(!text.includes("pfw_policy_info"));
});

test("attached to nothing, the firewall is not up and has no counters", async () => {
  const text = await render(document({ ...STATUS, interfaces: [] }, { shadow: false, rules: {} }));

  assert(text.includes("pfw_up 0"));
  assert(!/^pfw_packets_seen_total \d/m.test(text));
});
