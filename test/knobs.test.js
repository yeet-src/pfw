import { assert, assertEquals } from "yeet:assert";

import { knobs as renderKnobs } from "#/ctl/render/knobs.js";
import { palette } from "#/ctl/render/palette.js";
import { Knobs } from "#/fw/knobs.js";
import { Policy } from "#/fw/policy.js";

const { test } = yeet;

const SOURCE = `// @description Guards a web port.
// @knob port  The port to guard.
filter {
  if (dport != knob("port") ?? 80) decide pass;
  if (kstr("bad_host")) decide drop("blocked_host");
  decide pass;
}
`;

const web = () => new Policy("rules:http/web.pfc@a1b2c3d", SOURCE);
const other = () => new Policy("rules:http/other.pfc@a1b2c3d", `filter { if (dport != knob("port") ?? 443) decide pass; decide pass; }`);

const throws = (fn, text) => {
  try {
    fn();
  } catch (error) {
    return assert(error.message.includes(text), error.message);
  }
  throw new Error(`Expected a refusal holding "${text}"`);
};

test("a policy declares its knobs, with defaults and what they are for", () => {
  assertEquals(web().knobs, [
    { name: "port", kind: "number", default: 80n, about: "The port to guard." },
    { name: "bad_host", kind: "string", default: "", about: null },
  ]);
  assertEquals(web().key, "rules:http/web.pfc");
});

test("a value belongs to the policy it was set for", () => {
  const knobs = new Knobs();
  knobs.set(web(), "port", "8080");

  assertEquals(knobs.options(web()), { knobs: { port: 8080n }, knobStrs: { bad_host: "" } });
  assertEquals(knobs.options(other()), { knobs: { port: 443n }, knobStrs: {} });
});

test("a value outlives the revision it was set at, and a restart", () => {
  const knobs = new Knobs();
  knobs.set(web(), "port", "0x1f90");
  knobs.set(web(), "bad_host", "evil.example.com");

  const later = new Policy("rules:http/web.pfc@ffffff0", SOURCE);
  const restored = new Knobs(JSON.parse(JSON.stringify(knobs)));

  assertEquals(restored.options(later), { knobs: { port: 8080n }, knobStrs: { bad_host: "evil.example.com" } });
});

test("unset goes back to the policy's default", () => {
  const knobs = new Knobs();
  knobs.set(web(), "port", "8080");

  assertEquals(knobs.unset(web(), "port").value, 80n);
  assertEquals(knobs.of(web())[0].set, false);
  assertEquals(JSON.stringify(knobs), "{}");
});

test("a knob the policy lacks, and a value that does not fit, are refused", () => {
  const knobs = new Knobs();

  throws(() => knobs.set(web(), "prot", "1"), "has no knob prot (it has: port, bad_host)");
  throws(() => knobs.set(web(), "port", "eighty"), "is a number");
  throws(() => knobs.set(web(), "port", "0x1ffffffffffffffff"), "64 bits");
  throws(() => knobs.set(web(), "bad_host", "x".repeat(65)), "64 bytes");
});

test("knobs list in columns, the set ones saying their default", () => {
  const knobs = new Knobs();
  knobs.set(web(), "port", "8080");
  const text = renderKnobs({ policy: web().name, state: "enforcing", knobs: knobs.of(web()) }, palette(false)).split("\n");

  assertEquals(text, [
    "knobs of rules:http/web.pfc @ a1b2c3d   enforcing",
    "  port      8080  set, default 80  The port to guard.",
    '  bad_host  ""    default',
  ]);
});
