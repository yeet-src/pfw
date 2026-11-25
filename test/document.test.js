import { assert } from "yeet:assert";
import { render } from "yeet:telemetry";

import { document } from "#/metrics/document.js";

const { test } = yeet;

const POLICY = {
  at: "default", place: "default",
  name: "rules:http/log4shell.pfc@abc1234", bytes: 120, rules: ["crawler"], applied_at: 1_700_000_000_000,
  meta: { severity: "critical", cves: ["CVE-2021-44228", "CVE-2021-45046"] },
  knobs: [
    { name: "port", kind: "number", default: 80n, value: 8080n, set: true },
    { name: "bad_host", kind: "string", default: "", value: "evil.example.com", set: true },
  ],
};

const STATUS = { running: true, interfaces: [{ name: "lo", index: 1 }], policy: POLICY, policies: [POLICY] };

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
  ran: 9n, shadowed: 3n, enforced: 4n, src_enforced: 1n, logged: 5n, ring_full: 2n, sampled: 0n, nat_reversed: 0n,
  reasm_retrans: 1n, reasm_midjoin: 2n, reasm_held: 0n, reasm_slid: 0n, reasm_over: 0n, reasm_trunc: 6n,
  h2_blocks: 7n, h2_raw: 0n, h2_unresolved: 0n, h2_trunc: 0n, h2_failed: 1n,
  rules: { crawler: 2n },
  timing: { crawler: { runs: 2n, ns: 900n } },
  programs: [{ at: "default", rules: { crawler: 2n }, enforced_rules: { crawler: 5n }, timing: { crawler: { runs: 2n, ns: 900n } } }],
  shadow_enforced: 8n,
  decide_hist: { bounds: [100, 1000], counts: [4n, 5n, 1n] },
};

// Every metric pfw exports. contrib/check.sh reads this list, and holds the
// alerts and the dashboard in contrib/ to it.
const EXPORTED = [
  "pfw_up",
  "pfw_interface_info",
  "pfw_shadow",
  "pfw_trial_pending",
  "pfw_policy_enforcing",
  "pfw_policy_info",
  "pfw_policy_applied_timestamp_seconds",
  "pfw_knob",
  "pfw_packets_seen_total",
  "pfw_packets_total",
  "pfw_bans_total",
  "pfw_program_runs_total",
  "pfw_shadowed_total",
  "pfw_shadow_standing_packets_total",
  "pfw_standing_verdict_packets_total",
  "pfw_scanned_bytes_total",
  "pfw_faults_total",
  "pfw_flows_created_total",
  "pfw_nat_reversed_total",
  "pfw_events_logged_total",
  "pfw_events_dropped_total",
  "pfw_frames_sampled_total",
  "pfw_reassembly_total",
  "pfw_h2_total",
  "pfw_rule_hits_total",
  "pfw_rule_standing_packets_total",
  "pfw_rule_runs_total",
  "pfw_rule_decide_nanoseconds_total",
  "pfw_decide_duration_nanoseconds",
];

test("the list of exported metrics is the page, no more and no less", async () => {
  const text = await render(document({ ...STATUS, on_trial: true }, STATS));
  const families = new Set([...text.matchAll(/^# TYPE (pfw_\S+) /gm)].map(([, name]) => name));

  for (const name of EXPORTED) assert(families.has(name), `${name} is listed and not exported`);
  for (const name of families) assert(EXPORTED.includes(name), `${name} is exported and not listed`);
  assert(text.includes("pfw_trial_pending 1"));
});

test("a loaded policy renders its counters by verdict and rule", async () => {
  const text = await render(document(STATUS, STATS));

  assert(text.includes("pfw_up 1"));
  assert(text.includes('pfw_policy_info{route="default",name="rules:http/log4shell.pfc@abc1234",rev="abc1234",severity="critical",cve="CVE-2021-44228,CVE-2021-45046"} 1'));
  assert(text.includes('pfw_packets_total{verdict="rst"} 2'));
  assert(text.includes('pfw_rule_hits_total{route="default",rule="crawler"} 2'));
  assert(text.includes('pfw_rule_standing_packets_total{route="default",rule="crawler"} 5'));
});

test("every policy in place has its own series, by where it is", async () => {
  const api = { ...POLICY, at: "tcp/8443", place: "route", name: "rules:api.pfc@abc1234", meta: {}, knobs: POLICY.knobs };
  const programs = [...STATS.programs, { at: "tcp/8443", rules: { crawler: 7n }, enforced_rules: {}, timing: {} }];
  const text = await render(document({ ...STATUS, policies: [POLICY, api] }, { ...STATS, programs }));

  assert(text.includes('pfw_policy_info{route="tcp/8443",name="rules:api.pfc@abc1234",rev="abc1234"} 1'), text);
  assert(text.includes('pfw_policy_applied_timestamp_seconds{route="tcp/8443"} 1700000000'), text);
  assert(text.includes('pfw_rule_hits_total{route="default",rule="crawler"} 2'));
  assert(text.includes('pfw_rule_hits_total{route="tcp/8443",rule="crawler"} 7'));
  assert(text.includes('pfw_knob{policy="rules:api.pfc",knob="port"} 8080'));
});

test("decide buckets are cumulative and end at the total", async () => {
  const text = await render(document(STATUS, STATS));

  assert(text.includes('pfw_decide_duration_nanoseconds_bucket{le="100"} 4'));
  assert(text.includes('pfw_decide_duration_nanoseconds_bucket{le="1000"} 9'));
  assert(text.includes('pfw_decide_duration_nanoseconds_bucket{le="+Inf"} 10'));
  assert(text.includes("pfw_decide_duration_nanoseconds_sum 5000"));
});

test("no policy leaves the policy series out", async () => {
  const text = await render(document({ ...STATUS, policy: null, policies: [] }, { ...STATS, rules: {}, programs: [] }));

  assert(text.includes("pfw_policy_enforcing 0"));
  assert(!text.includes("pfw_policy_info"));
});

test("attached to nothing, the firewall is not up and has no counters", async () => {
  const text = await render(document({ ...STATUS, interfaces: [] }, { shadow: false, rules: {} }));

  assert(text.includes("pfw_up 0"));
  assert(!/^pfw_packets_seen_total \d/m.test(text));
});

test("everything else the VM counts is exported too", async () => {
  const text = await render(document(STATUS, STATS));

  for (const line of [
    "pfw_program_runs_total 9",
    "pfw_shadowed_total 3",
    "pfw_shadow_standing_packets_total 8",
    'pfw_standing_verdict_packets_total{scope="flow"} 4',
    'pfw_standing_verdict_packets_total{scope="source"} 1',
    "pfw_events_dropped_total 2",
    'pfw_reassembly_total{event="mid_join"} 2',
    'pfw_reassembly_total{event="truncated"} 6',
    'pfw_h2_total{event="decoded"} 7',
    'pfw_h2_total{event="failed"} 1',
    'pfw_rule_runs_total{route="default",rule="crawler"} 2',
    'pfw_rule_decide_nanoseconds_total{route="default",rule="crawler"} 900',
  ]) assert(text.includes(`${line}\n`), line);
});

test("numeric knobs are gauges; a string knob is not", async () => {
  const text = await render(document(STATUS, STATS));

  assert(text.includes('pfw_knob{policy="rules:http/log4shell.pfc",knob="port"} 8080'));
  assert(!text.includes("bad_host"));
});

test("a packet is counted under one verdict, and a ban apart from them", async () => {
  const text = await render(document(STATUS, { ...STATS, dropped: 9n, rsts: 96n, bans: 3n }));
  assert(text.includes('pfw_packets_total{verdict="rst"} 96'));
  assert(text.includes('pfw_packets_total{verdict="drop"} 9'));
  assert(!text.includes('verdict="ban"'));
  assert(text.includes("pfw_bans_total 3"));
});
