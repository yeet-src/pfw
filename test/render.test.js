import { assert, assertEquals } from "yeet:assert";

import { catalog } from "#/ctl/render/catalog.js";
import { count, duration } from "#/ctl/render/format.js";
import { render } from "#/ctl/render/index.js";
import { palette } from "#/ctl/render/palette.js";
import { status } from "#/ctl/render/status.js";

const { test } = yeet;

const NOW = 1_700_000_000_000;
const plain = palette(false);

const REPORT = {
  running: true,
  started_at: NOW - 3 * 86_400_000 - 4 * 3_600_000,
  interfaces: [{ name: "eth0", index: 2 }],
  policy: { name: "acme:edge/waf.pfc@a1b2c3d", bytes: 120, rules: ["-", "sqli"], applied_at: NOW - 7_200_000, knobs: [{ name: "port", kind: "number", default: 80n, value: 8080n, set: true }, { name: "enforce", kind: "number", default: 1n, value: 1n, set: false }] },
  shadow: false,
  counters: { seen: 1_234_567n, passed: 1_190_000n, dropped: 312n, rsts: 4100n, bans: 0n, faults: 0n },
  rules: { "-": 9n, sqli: 3900n, crawler: 212n },
};

test("counts and durations read as a person writes them", () => {
  assertEquals(count(312n), "312");
  assertEquals(count(4100n), "4.1k");
  assertEquals(count(1_234_567n), "1.23M");
  assertEquals(duration(41_000), "41s");
  assertEquals(duration(3 * 86_400_000 + 4 * 3_600_000 + 5), "3d 4h");
});

test("status shows the policy, the verdicts and the busiest rules first", () => {
  const text = status(REPORT, plain, NOW);

  assert(text.includes("● pfw  up 3d 4h   on eth0"));
  assert(text.includes("acme:edge/waf.pfc @ a1b2c3d   enforcing   applied 2h ago"));
  assert(text.includes("1.23M seen   pass 1.19M   drop 312   rst 4.1k   ban 0"));
  assert(text.includes("  knobs    port 8080\n"));
  assert(text.includes("sqli 3.9k   crawler 212"));
  assert(!text.includes("- 9"));
});

test("status without a policy says everything passes", () => {
  const text = status({ ...REPORT, policy: null, rules: {} }, plain, NOW);

  assert(text.includes("none: passing everything"));
  assert(!text.includes("rules"));
});

test("plain text carries no escapes and tty text carries no dim", () => {
  const result = { view: "status", ok: true, data: REPORT, notice: "applied x" };

  assert(!render(result, "plain").includes("\x1b"));
  const colored = render(result, "tty");
  assert(colored.includes("\x1b[1;38;5;46m"));
  assert(!/\x1b\[(?:\d+;)*2m/.test(colored));
});

test("the catalog numbers policies and marks the active one and the broken ones", () => {
  const text = catalog({
    active: "acme:edge/waf.pfc@a1b2c3d",
    entries: [
      { name: "acme:edge/bots.pfc@a1b2c3d", ok: true, rules: ["-", "bot"], errors: [] },
      { name: "acme:edge/waf.pfc@a1b2c3d", ok: true, rules: ["-"], errors: [] },
      { name: "acme:broken.pfc@a1b2c3d", ok: false, rules: [], errors: [{ line: 3, text: "nope" }] },
    ],
  }, plain).split("\n");

  assertEquals(text, [
    "edge",
    "  1 ✔ acme:edge/bots.pfc  2 rules",
    "▸ 2 ✔ acme:edge/waf.pfc   1 rule   active",
    "",
    "  3 ✘ acme:broken.pfc     line 3: nope",
  ]);
});

test("the catalog says when the active policy is from another revision", () => {
  const text = catalog({
    active: "acme:waf.pfc@old1234",
    entries: [{ name: "acme:waf.pfc@new5678", ok: true, rules: [], errors: [] }],
  }, plain);

  assert(text.includes("active at old1234, this is new5678"));
});

test("interfaces mark the attached ones and the ones that are down", async () => {
  const { interfaces } = await import("#/ctl/render/interfaces.js");
  const text = interfaces({
    available: [{ name: "lo", index: 1, up: true }, { name: "eth0", index: 2, up: true }, { name: "docker0", index: 3, up: false }],
    attached: ["eth0"],
  }, plain).split("\n");

  assertEquals(text[0], "  lo      ifindex 1   up");
  assertEquals(text[1], "▸ eth0    ifindex 2   up   attached");
  assertEquals(text[2], "  docker0 ifindex 3   down");
});

test("status attached to nothing says nothing is filtered", () => {
  const text = status({ ...REPORT, interfaces: [] }, plain, NOW);

  assert(text.includes("on no interface: nothing is filtered"));
  assert(text.includes("held: no interface to enforce on"));
});

test("a filtered catalog keeps the numbers of the whole list, and says how many", () => {
  const text = catalog({
    active: null,
    total: 200,
    filtered: true,
    entries: [{ number: 137, name: "old:a.pfc@1234567", ok: true, rules: [], errors: [] }],
  }, plain).split("\n");

  assertEquals(text, ["  137 ✔ old:a.pfc  0 rules", "", "1 of 200 policies"]);
});

test("a catalog nothing matches says so, and how many there were", () => {
  assertEquals(catalog({ active: null, total: 10, filtered: true, entries: [] }, plain), "none of the 10 policies match");
});

test("metrics lay the verdicts, rules and decision times out in columns", async () => {
  const { metrics } = await import("#/ctl/render/metrics.js");
  const text = metrics({
    attached: true,
    stats: {
      shadow: false,
      seen: 1000n, passed: 900n, dropped: 100n, rsts: 0n, bans: 0n,
      scanned_bytes: 4096n, faults: 0n, flows_created: 12n, decide_ns: 400_000n,
      rules: { "-": 900n, sqli: 100n },
      timing: { "-": { runs: 900n, ns: 90_000n }, sqli: { runs: 100n, ns: 310_000n } },
      decide_hist: { bounds: [100, 1000], counts: [900n, 0n, 100n] },
    },
  }, plain).split("\n");

  assertEquals(text[0], "packets  1k seen");
  assertEquals(text[1], `  pass  900  90.0%  ${"█".repeat(21)}▋`);
  assertEquals(text[2], "  drop  100  10.0%  ██▍");
  assert(text.includes("  sqli  100  3.1µs  ████████████████████████"));
  assert(text.includes("  packets that matched no rule took 100ns each to pass"));
  assert(!text.some((line) => line.includes("(no rule)")));
  assert(text.includes("decision time  mean 400ns over 1k   p50 < 100ns  p90 < 100ns  p99 ≥ 1µs"));
  assert(text.includes("  < 100ns  900  90.0%  ████████████████████████"));
  assert(text.includes("  ≥ 1µs    100  10.0%  ██▋"));
  assert(text.includes("  scanned bytes  4KiB"));
  assert(!text.some((line) => line.includes("faults")));
});

test("metrics with no interface say nothing is counted", async () => {
  const { metrics } = await import("#/ctl/render/metrics.js");

  assertEquals(metrics({ attached: false, stats: { shadow: false, rules: {} } }, plain), "attached to no interface: nothing is counted");
});

test("the catalog puts what a policy says about itself under its row", () => {
  const text = catalog({
    active: null,
    entries: [
      {
        name: "rules:http/log4shell.pfc@a1b2c3d", ok: true, rules: ["-", "jndi"], errors: [],
        meta: { description: "Resets JNDI lookups.", patches: "Apache Log4j 2.x", severity: "critical", cves: ["CVE-2021-44228"], tags: ["http", "rce"] },
        knobs: [
          { name: "port", kind: "number", default: 80n, value: 8080n, set: true, about: "The port to guard." },
          { name: "enforce", kind: "number", default: 1n, value: 1n, set: false, about: "1 to reset, 0 to count." },
        ],
      },
      { name: "rules:pass.pfc@a1b2c3d", ok: true, rules: ["-"], errors: [], meta: { description: null, patches: null, severity: null, cves: [], tags: [] } },
    ],
  }, plain).split("\n");

  assertEquals(text, [
    "http",
    "  1 ✔ rules:http/log4shell.pfc  2 rules",
    "      Resets JNDI lookups.",
    "      CVE-2021-44228  critical  patches Apache Log4j 2.x  #http  #rce",
    "      knob  port     8080  set  The port to guard.",
    "      knob  enforce  1          1 to reset, 0 to count.",
    "",
    "  2 ✔ rules:pass.pfc            1 rule",
  ]);
});

test("tags are all one blue", () => {
  assertEquals(palette(true).tag("#http"), "\x1b[1;38;5;39m#http\x1b[0m");
  assertEquals(palette(false).tag("#http"), "#http");
});

test("shadow mode is said on the first line, with what would have been blocked", () => {
  const text = status({ ...REPORT, shadow: true, shadowed: 329n }, plain, NOW);

  assert(text.includes("on eth0   shadow mode: nothing is blocked"));
  assert(text.includes("shadow (dry run)"));
  assert(text.includes("ban 0   would block 329"));
});
