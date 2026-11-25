import { assert, assertEquals } from "yeet:assert";

import { metrics } from "#/ctl/render/metrics.js";
import { palette } from "#/ctl/render/palette.js";
import { Rates, quantile } from "#/fw/rates.js";

const { test } = yeet;

const at = (second, seen, dropped = 0, rules = {}) =>
  [{ seen: BigInt(seen), passed: BigInt(seen - dropped), dropped: BigInt(dropped), rsts: 0n, bans: 0n, scanned_bytes: BigInt(seen * 100), flows_created: 0n, shadowed: 0n, rules }, second * 1000];

test("a speed is the last second, the window's mean, and its fastest second", () => {
  const rates = new Rates();
  rates.push(...at(0, 0));
  rates.push(...at(1, 100));
  rates.push(...at(2, 400, 30));
  rates.push(...at(3, 450, 30));

  const { packets, blocked, scanned, flows } = rates.speeds();
  assertEquals([packets.now, packets.mean, packets.peak], [50, 150, 300]);
  assertEquals(packets.history, [100, 300, 50]);
  assertEquals([blocked.now, blocked.peak], [0, 30]);
  assertEquals(scanned.mean, 15000);
  assertEquals(flows.peak, 0);
  assertEquals(rates.seconds, 3);
});

test("there is no speed until there are two samples", () => {
  const rates = new Rates();
  assertEquals(rates.speeds(), null);
  rates.push(...at(0, 5));
  assertEquals(rates.speeds(), null);
});

test("counters that went down start the window over", () => {
  const rates = new Rates();
  rates.push(...at(0, 1000));
  rates.push(...at(1, 2000));
  rates.push(...at(2, 10));
  rates.push(...at(3, 30));

  assertEquals(rates.speeds().packets.history, [20]);
});

test("rules have a speed over the window", () => {
  const rates = new Rates();
  rates.push(...at(0, 0, 0, { sqli: 0n }));
  rates.push(...at(4, 100, 0, { sqli: 20n }));

  assertEquals(rates.ruleSpeeds(), { "default\nsqli": 5 });
});

test("a rule's speed is its own, whichever policy names another alike", () => {
  const programs = (a, b) => ({ programs: [{ at: "default", rules: { sqli: a }, enforced_rules: {}, timing: {} }, { at: "tcp/8443", rules: { sqli: b }, enforced_rules: {}, timing: {} }] });
  const rates = new Rates();
  rates.push({ ...at(0, 0)[0], ...programs(0n, 0n) }, 0);
  rates.push({ ...at(4, 100)[0], ...programs(20n, 8n) }, 4000);

  assertEquals(rates.ruleSpeeds(), { "default\nsqli": 5, "tcp/8443\nsqli": 2 });
});

test("a percentile is the bound it falls under", () => {
  const hist = { bounds: [100, 1000], counts: [90n, 9n, 1n] };

  assertEquals(quantile(hist, 0.5), 100);
  assertEquals(quantile(hist, 0.99), 1000);
  assertEquals(quantile(hist, 0.999), null);
  assertEquals(quantile({ bounds: [100], counts: [0n, 0n] }, 0.5), undefined);
});

test("the metrics page shows speeds with a sparkline, and percentiles", () => {
  const rates = new Rates();
  rates.push(...at(0, 0));
  rates.push(...at(1, 100));
  rates.push(...at(2, 400, 30));
  const [stats] = at(2, 400, 30);

  const text = metrics({
    attached: true,
    stats: { ...stats, decide_ns: 40_000n, decide_hist: { bounds: [100, 1000], counts: [390n, 9n, 1n] } },
    speeds: rates.speeds(),
    window: rates.seconds,
  }, palette(false));

  assert(text.includes("speed  now, mean and peak over the last 2s"));
  assert(text.includes("  packets  300/s      200/s      300/s      ▃█"), text);
  assert(text.includes("  blocked  30/s       15/s       30/s        █"), text);
  assert(text.includes("  scanned  29.3KiB/s  19.5KiB/s  29.3KiB/s  ▃█"), text);
  assert(!text.includes("flows"));
  assert(text.includes("p50 < 100ns  p90 < 100ns  p99 < 1µs"));
});

test("a chart stacks a history into rows, newest on the right", async () => {
  const { chart } = await import("#/ctl/render/bars.js");

  // Against the tallest, 8: it fills both rows, 4 the lower one, 2 half of that.
  assertEquals(chart([0, 4, 8, 2], 6, 2), ["    █ ", "   ██▄"]);
  assertEquals(chart([], 3, 2), ["   ", "   "]);
});

test("a history is fitted to the columns there are", async () => {
  const { resample } = await import("#/ctl/render/bars.js");

  // Fewer samples than columns: each is drawn wider. More: the tallest of each stretch.
  assertEquals(resample([1, 2], 4), [1, 1, 2, 2]);
  assertEquals(resample([1, 9, 2, 3, 4, 5], 3), [9, 3, 5]);
  assertEquals(resample([], 4), []);
});
