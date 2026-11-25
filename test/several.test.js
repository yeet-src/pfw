import { assert, assertEquals } from "yeet:assert";

import { commands } from "#/ctl/commands.js";
import { ruleCounts, withPrograms } from "#/fw/counted.js";
import { render } from "#/ctl/render/index.js";
import { Firewall } from "#/fw/firewall.js";
import { Knobs } from "#/fw/knobs.js";
import { DEFAULT, FIRST, parsePlace } from "#/fw/place.js";
import { Policy } from "#/fw/policy.js";
import { Ruleset } from "#/fw/ruleset.js";
import { Scopes, scoped, scopedKnob } from "#/fw/scopes.js";
import { SavedState } from "#/fw/saved.js";

const { test } = yeet;

const PASS = "filter { decide pass; }";
const name = (file) => `rules:${file}.pfc@a1b2c3d`;
const policy = (file, source = PASS) => new Policy(name(file), source);
const source = (file, text = PASS) => ({ name: name(file), source: text });
const guarding = (file, port) => policy(file, `filter { if (dport != knob("port") ?? ${port}) decide pass; decide pass; }`);

const API = parsePlace("tcp/8443");
const TENANT = parsePlace("10.1.0.0/16");

// Attached to nothing, a firewall has no VM, and needs no kernel.
async function firewall() {
  const fw = new Firewall({ interfaces: [], object: "", base: "" });
  await fw.start();
  return fw;
}

const saved = (fw) => JSON.parse(new SavedState("/x").moduleOf(fw).replace(/^export default /, "").replace(/;\n$/, ""));
const inPlace = (fw) => fw.rules.entries().map(({ at, policy: p }) => `${at}=${p.key}`);

async function refuses(run, text) {
  try {
    await run();
  } catch (error) {
    return assert(error.message.includes(text), error.message);
  }
  throw new Error(`Expected a refusal holding "${text}"`);
}

test("a policy goes beside the ones in other places, and replaces the one in its own", async () => {
  const fw = await firewall();
  await fw.enforce(policy("waf"));
  await fw.enforce(policy("api"), API);
  await fw.enforce(policy("tenant"), TENANT);
  assertEquals(inPlace(fw), ["default=rules:waf.pfc", "tcp/8443=rules:api.pfc", "10.1.0.0/16=rules:tenant.pfc"]);

  await fw.enforce(policy("api2"), parsePlace("TCP/8443"));
  await fw.enforce(policy("waf2"));
  assertEquals(inPlace(fw), ["default=rules:waf2.pfc", "tcp/8443=rules:api2.pfc", "10.1.0.0/16=rules:tenant.pfc"]);
  assertEquals(fw.policy.key, "rules:waf2.pfc");
});

test("the chain run first grows in order, and a policy already in it is replaced where it stands", async () => {
  const fw = await firewall();
  await fw.enforce(policy("blocklist"), FIRST);
  await fw.enforce(policy("flood"), FIRST);
  await fw.enforce(new Policy("rules:blocklist.pfc@ffff000", PASS), FIRST);

  assertEquals(inPlace(fw), ["first=rules:blocklist.pfc", "first.1=rules:flood.pfc"]);
  assertEquals(fw.rules.first[0].name, "rules:blocklist.pfc@ffff000");
});

test("a policy that reads a stream cannot run first, and eight is the most that can", async () => {
  const fw = await firewall();
  await refuses(() => fw.enforce(policy("stream", `reassemble 80;\n${PASS}`), FIRST), "reads a reassembled or decoded stream");
  assertEquals(inPlace(fw), []);

  for (let i = 0; i < 8; i++) await fw.enforce(policy(`stage${i}`), FIRST);
  await refuses(() => fw.enforce(policy("ninth"), FIRST), "At most 8 policies run first");
  assertEquals(fw.rules.first.length, 8);
});

test("clear empties one place, or all of them", async () => {
  const fw = await firewall();
  await fw.enforce(policy("waf"));
  await fw.enforce(policy("api"), API);
  await fw.enforce(policy("flood"), FIRST);

  await fw.clear(API);
  assertEquals(inPlace(fw), ["default=rules:waf.pfc", "first=rules:flood.pfc"]);
  await refuses(() => fw.clear(API), "No policy is in place at tcp/8443");

  await fw.clear(DEFAULT);
  assertEquals(inPlace(fw), ["first=rules:flood.pfc"]);
  assertEquals(fw.policy, null);

  await fw.clear();
  assert(fw.rules.empty);
});

test("rollback brings back every policy the last change took away", async () => {
  const fw = await firewall();
  await fw.enforce(policy("waf"));
  await fw.enforce(policy("api"), API);
  await fw.clear();
  await fw.rollback();
  assertEquals(inPlace(fw), ["default=rules:waf.pfc", "tcp/8443=rules:api.pfc"]);

  await fw.rollback();
  assert(fw.rules.empty);
});

test("a trial goes back to every policy as it was", async () => {
  const fw = await firewall();
  await fw.enforce(policy("waf"));

  const before = fw.snapshot();
  await fw.enforce(policy("api"), API);
  await fw.enforce(policy("flood"), FIRST);
  fw.tryFor(60_000, before);

  assertEquals(saved(fw).routes, []);
  await fw.rollback();
  assertEquals(inPlace(fw), ["default=rules:waf.pfc"]);
});

test("every policy and its place survive a restart, and so do the ones before", async () => {
  const fw = await firewall();
  await fw.enforce(policy("waf"));
  await fw.enforce(policy("api"), API);
  await fw.enforce(policy("blocklist"), FIRST);
  await fw.enforce(policy("flood"), FIRST);

  const kept = saved(fw);
  assertEquals(kept.policy.name, name("waf"));
  assertEquals(kept.routes, [{ at: "tcp/8443", policy: source("api") }]);
  assertEquals(kept.first.map((p) => p.name), [name("blocklist"), name("flood")]);

  const next = await firewall();
  await new SavedState("/x").restorePolicy(next, kept);
  assertEquals(inPlace(next), ["default=rules:waf.pfc", "first=rules:blocklist.pfc", "first.1=rules:flood.pfc", "tcp/8443=rules:api.pfc"]);

  await next.rollback();
  assertEquals(inPlace(next), ["default=rules:waf.pfc", "first=rules:blocklist.pfc", "tcp/8443=rules:api.pfc"]);
});

test("state saved before there were places still loads", async () => {
  const next = await firewall();
  await new SavedState("/x").restorePolicy(next, { interfaces: [], policy: source("b"), previous: source("a"), knobs: {}, shadow: false });

  assertEquals(inPlace(next), ["default=rules:b.pfc"]);
  await next.rollback();
  assertEquals(inPlace(next), ["default=rules:a.pfc"]);
});

test("a saved route that cannot be placed is left out, and the rest come up", async () => {
  const next = await firewall();
  await new SavedState("/x").restorePolicy(next, {
    policy: source("waf"),
    routes: [{ at: "tcp/22,if=gone0", policy: source("ssh") }, { at: "tcp/8443", policy: source("api") }],
  });

  assertEquals(inPlace(next), ["default=rules:waf.pfc", "tcp/8443=rules:api.pfc"]);
});

test("policies in place together each keep their own value for a knob of the same name", async () => {
  const fw = await firewall();
  await fw.enforce(guarding("web", 80));
  await fw.enforce(guarding("api", 8443), API);

  await fw.setKnob(fw.policy, "port", "8080");
  assertEquals(fw.knobs.toJSON(), { "rules:web.pfc": { port: "8080" } });
  assertEquals(fw.knobs.of(fw.rules.at(API))[0].value, 8443n);

  await fw.unsetKnob(fw.policy, "port");
  assertEquals(fw.knobs.toJSON(), {});
});

test("a policy in place has a scope of its own, which one that arrives never takes", () => {
  const scopes = new Scopes();
  assertEquals([scopes.of("a"), scopes.of("b"), scopes.of("a")], [0, 1, 0]);

  // `c` replaces `a`: it is given its scope while `a` still has one.
  assertEquals(scopes.of("c"), 2);
  scopes.keep(["b", "c"]);
  assertEquals([scopes.of("b"), scopes.of("c"), scopes.of("d")], [1, 2, 0]);
});

test("the VM is handed a policy's knobs under its scope, each with its value", () => {
  const web = new Policy(name("web"), `filter {
    if (dport != knob("port") ?? 80) decide pass;
    if (kstr("bad_host")) decide drop("host");
    if (knob("enforce") ?? 1 == 0) decide pass;
    decide pass;
  }`);
  const knobs = new Knobs();
  knobs.set(web, "enforce", "0");
  const { program, options } = scoped(3, web, knobs.of(web));

  assertEquals(program.knobs, ["3 0", "3 1"]);
  assertEquals(program.knobStrs, ["3 0"]);
  assertEquals(program.program, web.compiled.program);
  assertEquals(options, { knobs: { "3 0": 80n, "3 1": 0n }, knobStrs: { "3 0": "" } });
  assertEquals(scopedKnob(3, web, { name: "enforce", kind: "number" }), "3 1");
  assertEquals(scopedKnob(3, web, { name: "bad_host", kind: "string" }), "3 0");
  assertEquals(scopedKnob(3, web, { name: "gone", kind: "number" }), null);
});

test("a knob command that names no policy means the one in place that has the knob", async () => {
  const fw = await firewall();
  const request = (rest) => ({ rest, sources: [] });
  await refuses(() => commands["knob-set"](fw, request("0 port 81")), "No policy is enforcing: name one");
  await refuses(() => commands.knobs(fw, request("0")), "No policy is enforcing: name one");

  await fw.enforce(guarding("web", 80));
  await fw.enforce(policy("flood"), FIRST);
  assertEquals((await commands["knob-set"](fw, request("0 port 81"))).notice, "port = 81 for rules:web.pfc");

  await fw.enforce(guarding("api", 8443), API);
  await refuses(() => commands["knob-set"](fw, request("0 port 82")), "port is a knob of rules:web.pfc and rules:api.pfc: name one");
  await refuses(() => commands["knob-unset"](fw, request("0 prot")), "No policy in place has a knob prot");

  const named = await commands["knob-set"](fw, { rest: "1 port 9443", sources: [{ name: name("api"), source: fw.rules.at(API).source }] });
  assertEquals(named.notice, "port = 9443 for rules:api.pfc");
  assertEquals(fw.knobs.toJSON(), { "rules:web.pfc": { port: "81" }, "rules:api.pfc": { port: "9443" } });
});

test("knobs with no policy named lists every policy in place, and where each is", async () => {
  const fw = await firewall();
  await fw.enforce(guarding("web", 80));
  await fw.enforce(guarding("web", 80), TENANT);
  await fw.enforce(guarding("api", 8443), API);
  await fw.setKnob(fw.rules.at(API), "port", "9443");

  const listed = await commands.knobs(fw, { rest: "0", sources: [] });
  assertEquals(listed.data.policies.map((p) => [p.policy, p.at]), [[name("web"), ["default", "10.1.0.0/16"]], [name("api"), ["tcp/8443"]]]);
  assertEquals(listed.data.policy, name("web"));
  assertEquals(render(listed, "plain").split("\n"), [
    "knobs of rules:web.pfc @ a1b2c3d   enforcing   default, 10.1.0.0/16",
    "  port  80  default",
    "knobs of rules:api.pfc @ a1b2c3d   enforcing   tcp/8443",
    "  port  9443  set, default 8443",
  ]);

  const text = render(await commands.status(fw), "plain");
  assert(text.includes("  knobs    port 9443 (rules:api.pfc)\n"), text);
});

test("the commands: apply at a place, clear a place, clear everything", async () => {
  const fw = await firewall();
  const request = (rest, file) => ({ rest, sources: file ? [source(file)] : [] });

  assert((await commands.apply(fw, request("22 x", "waf"))).notice.endsWith(`applied ${name("waf")}`));
  assert((await commands.apply(fw, request("at=tcp/8443 22 x", "api"))).notice.endsWith(`applied ${name("api")} for tcp/8443`));
  const chained = await commands.apply(fw, request("confirm=10m at=first 22 x", "flood"));
  assert(chained.notice.includes(`applied ${name("flood")} to run first, on trial`), chained.notice);
  assertEquals(chained.data.policies.map((p) => p.at), ["default", "first", "tcp/8443"]);
  fw.confirm();

  await refuses(() => commands.apply(fw, request("at=tcp/99999 22 x", "api")), "A port is a number");
  await refuses(() => commands.clear(fw, request("at=udp/53")), "No policy is in place at udp/53");

  const one = await commands.clear(fw, request("at=tcp/8443"));
  assertEquals(one.notice, `cleared ${name("api")}: 2 policies are still in place`);
  const all = await commands.clear(fw, request(""));
  assertEquals(all.notice, `cleared ${name("waf")}, ${name("flood")}: passing everything`);
  await refuses(() => commands.clear(fw, request("")), "No policy is enforcing");
});

test("the steps between two sets touch only the places that differ", () => {
  const [waf, api, flood] = [policy("waf"), policy("api"), policy("flood")];
  const before = Ruleset.EMPTY.with(DEFAULT, waf).with(API, api).with(FIRST, flood);
  const steps = (to, from) => to.changesFrom(from).map(([place, value]) => `${place.spec}:${[value].flat().map((p) => p?.key ?? "none").join("+") || "none"}`);

  assertEquals(steps(before, before), []);
  assertEquals(steps(before.with(TENANT, api), before), ["10.1.0.0/16:rules:api.pfc"]);
  assertEquals(steps(before.without(API).without(FIRST), before), ["tcp/8443:none", "first:none"]);
  assertEquals(steps(before, Ruleset.EMPTY), ["default:rules:waf.pfc", "tcp/8443:rules:api.pfc", "first:rules:flood.pfc"]);
  assertEquals(steps(Ruleset.EMPTY, before), ["tcp/8443:none", "default:none", "first:none"]);
});

test("each policy's counts are found where the VM keeps them", () => {
  const route = parsePlace("10.1.0.0/16,tcp/22,if=eth0", [{ name: "eth0", index: 2 }]);
  const rules = Ruleset.EMPTY.with(DEFAULT, policy("waf")).with(FIRST, policy("blocklist")).with(FIRST, policy("flood")).with(route, policy("ssh"));
  const stats = withPrograms({
    seen: 9n,
    rules: { sqli: 3n },
    timing: {},
    first: [{ name: "first", rules: { listed: 1n } }, { name: "first.1", rules: { flood: 2n } }],
    routes: { "10.1.0.0/16 if2 tcp/22": { rules: { sqli: 4n }, enforced_rules: { sqli: 40n } } },
  }, rules);

  assertEquals(stats.seen, 9n);
  assertEquals(stats.programs.map((p) => [p.at, p.rules]), [
    ["default", { sqli: 3n }],
    ["first", { listed: 1n }],
    ["first.1", { flood: 2n }],
    ["10.1.0.0/16 tcp/22 on eth0", { sqli: 4n }],
  ]);
  assertEquals(ruleCounts(stats).map((r) => [r.name, r.hits, r.stopped]), [
    ["sqli (10.1.0.0/16 tcp/22 on eth0)", 4, 40],
    ["sqli (default)", 3, 0],
    ["flood (first.1)", 2, 0],
    ["listed (first)", 1, 0],
  ]);
});
