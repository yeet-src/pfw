import { assert, assertEquals } from "yeet:assert";

import { commands } from "#/ctl/commands.js";
import { palette } from "#/ctl/render/palette.js";
import { status } from "#/ctl/render/status.js";
import { confirmOf } from "#/ctl/request.js";
import { Firewall } from "#/fw/firewall.js";
import { Policy } from "#/fw/policy.js";
import { SavedState } from "#/fw/saved.js";
import { Trial, parseSpan } from "#/fw/trial.js";

const { test } = yeet;

const policy = (name) => new Policy(`rules:${name}.pfc@a1b2c3d`, "filter { decide pass; }");
const source = (name) => ({ name: `rules:${name}.pfc@a1b2c3d`, source: "filter { decide pass; }" });

// Attached to nothing, a firewall has no VM, and needs no kernel.
async function firewall() {
  const fw = new Firewall({ interfaces: [], object: "", base: "" });
  await fw.start();
  return fw;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const saved = (fw) => JSON.parse(new SavedState("/x").moduleOf(fw).replace(/^export default /, "").replace(/;\n$/, ""));

async function refuses(run, text) {
  try {
    await run();
  } catch (error) {
    return assert(error.message.includes(text), error.message);
  }
  throw new Error(`Expected a refusal holding "${text}"`);
}

test("a time is a number and a unit, within bounds", async () => {
  assertEquals(parseSpan("90s"), 90_000);
  assertEquals(parseSpan("10m"), 600_000);
  assertEquals(parseSpan("1h"), 3_600_000);
  await refuses(() => parseSpan("10"), "like 10m");
  await refuses(() => parseSpan("ten"), "like 10m");
  await refuses(() => parseSpan("1s"), "between 5s and 24h");
  await refuses(() => parseSpan("25h"), "between 5s and 24h");
});

test("a header says whether a change is on trial", () => {
  assertEquals(confirmOf("confirm=10m 22 rules:a.pfc"), "10m");
  assertEquals(confirmOf("confirm=10m"), "10m");
  assertEquals(confirmOf("22 confirm=10m"), null);
  assertEquals(confirmOf(""), null);
});

test("a trial keeps what came first, and a second one only moves the deadline", () => {
  const trial = new Trial(() => {});
  trial.begin("first", 60_000, 1000);
  trial.begin("second", 120_000, 2000);

  assert(trial.pending);
  assertEquals(trial.before, "first");
  assertEquals(trial.until, 122_000);
  assertEquals(trial.end(), "first");
  assert(!trial.pending);
  assertEquals(trial.end(), null);
});

test("an unconfirmed change goes back by itself", async () => {
  const fw = await firewall();
  await fw.setShadow(true);
  await fw.enforce(policy("a"));

  const before = fw.snapshot();
  await fw.setShadow(false);
  await fw.enforce(policy("b"));
  fw.tryFor(30, before);

  assertEquals(fw.shadow, false);
  assertEquals(fw.policy.key, "rules:b.pfc");
  await sleep(80);

  assertEquals(fw.shadow, true);
  assertEquals(fw.policy.key, "rules:a.pfc");
  const report = await fw.report();
  assertEquals(report.trial, null);
  assert(report.lapsed_at > 0);
});

test("a confirmed change stays", async () => {
  const fw = await firewall();
  await fw.setShadow(true);

  const before = fw.snapshot();
  await fw.setShadow(false);
  fw.tryFor(30, before);
  assert(fw.confirm());
  await sleep(80);

  assertEquals(fw.shadow, false);
  assert(!fw.confirm());
});

test("a restart during a trial comes back to what was confirmed", async () => {
  const fw = await firewall();
  await fw.setShadow(true);
  await fw.enforce(policy("a"));

  const before = fw.snapshot();
  await fw.setShadow(false);
  await fw.enforce(policy("b"));
  fw.tryFor(60_000, before);

  assertEquals(saved(fw).shadow, true);
  assertEquals(saved(fw).policy.name, "rules:a.pfc@a1b2c3d");

  fw.confirm();
  assertEquals(saved(fw).shadow, false);
  assertEquals(saved(fw).policy.name, "rules:b.pfc@a1b2c3d");
});

test("rollback returns to the policy before, and again returns", async () => {
  const fw = await firewall();
  await refuses(() => fw.rollback(), "nothing to roll back to");

  await fw.enforce(policy("a"));
  await fw.enforce(policy("b"));
  await fw.rollback();
  assertEquals(fw.policy.key, "rules:a.pfc");
  await fw.rollback();
  assertEquals(fw.policy.key, "rules:b.pfc");
});

test("rollback of a first policy is no policy, and of a clear the policy", async () => {
  const fw = await firewall();
  await fw.enforce(policy("a"));
  await fw.rollback();
  assertEquals(fw.policy, null);

  await fw.rollback();
  assertEquals(fw.policy.key, "rules:a.pfc");
  await fw.clear();
  await fw.rollback();
  assertEquals(fw.policy.key, "rules:a.pfc");
});

test("rollback during a trial undoes the trial, now", async () => {
  const fw = await firewall();
  await fw.setShadow(true);
  await fw.enforce(policy("a"));

  const before = fw.snapshot();
  await fw.setShadow(false);
  fw.tryFor(60_000, before);
  await fw.rollback();

  assertEquals(fw.shadow, true);
  assertEquals(fw.policy.key, "rules:a.pfc");
  assert(!fw.trial.pending);
});

test("the policy before survives a restart", async () => {
  const fw = await firewall();
  await fw.enforce(policy("a"));
  await fw.enforce(policy("b"));

  const next = await firewall();
  await new SavedState("/x").restorePolicy(next, saved(fw));
  assertEquals(next.policy.key, "rules:b.pfc");
  await next.rollback();
  assertEquals(next.policy.key, "rules:a.pfc");
});

test("the commands: apply and unshadow on trial, confirm, rollback", async () => {
  const fw = await firewall();
  await fw.setShadow(true);

  const applied = await commands.apply(fw, { rest: "confirm=10m 22 x", sources: [source("a")] });
  assert(applied.notice.includes("on trial: undone in 10m unless you run pfw confirm"), applied.notice);
  assert(applied.data.trial.until > Date.now());

  const kept = await commands.confirm(fw, { rest: "" });
  assertEquals(kept.data.trial, null);
  await refuses(() => commands.confirm(fw, { rest: "" }), "Nothing is on trial");

  await refuses(() => commands.unshadow(fw, { rest: "confirm=soon" }), "like 10m");
  assertEquals(fw.shadow, true);

  await commands.unshadow(fw, { rest: "confirm=5s" });
  assertEquals(fw.shadow, false);
  const back = await commands.rollback(fw, { rest: "" });
  assert(back.notice.includes("rolled back the trial"), back.notice);
  assertEquals(fw.shadow, true);

  const plain = await commands.unshadow(fw, { rest: "" });
  assertEquals(plain.data.trial, null);
});

test("a bad policy on trial changes nothing and starts no trial", async () => {
  const fw = await firewall();
  await refuses(() => commands.apply(fw, { rest: "confirm=10m 3 x", sources: [{ name: "x", source: "nope" }] }), "does not compile");
  assert(!fw.trial.pending);
});

test("status says a change is on trial, and when one went back", async () => {
  const NOW = 1_700_000_000_000;
  const report = { ...(await (await firewall()).report()), started_at: NOW - 1000 };
  const p = palette(false);

  assert(status({ ...report, trial: { until: NOW + 552_000 } }, p, NOW).includes("  trial    undone in 9m 12s   pfw confirm keeps it, pfw rollback undoes it now"));
  assert(status({ ...report, lapsed_at: NOW - 180_000 }, p, NOW).includes("  trial    not confirmed: went back 3m ago"));
  assert(!status(report, p, NOW).includes("trial"));
});
