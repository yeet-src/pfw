import { assertEquals } from "yeet:assert";

import { parseMeta } from "#/fw/meta.js";

const { test } = yeet;

test("the opening comment block's @keys are the policy's metadata", () => {
  const meta = parseMeta(`// Blocks JNDI lookups.
// @description Resets connections that carry
// @description a JNDI lookup string.
// @patches Apache Log4j 2.0-beta9 to 2.14.1
// @cve cve-2021-44228, CVE-2021-45046
// @cve CVE-2021-45105
// @severity Critical
// @tags http rce
// @knob port  The port to guard.
// @knob enforce
// @author someone
filter { decide pass; }
`);

  assertEquals(meta, {
    description: "Resets connections that carry a JNDI lookup string.",
    patches: "Apache Log4j 2.0-beta9 to 2.14.1",
    severity: "critical",
    cves: ["CVE-2021-44228", "CVE-2021-45046", "CVE-2021-45105"],
    tags: ["http", "rce"],
    knobs: { port: "The port to guard.", enforce: "" },
  });
});

test("metadata ends where the comment block does", () => {
  const meta = parseMeta(`// @description The real one.

nocase;
// @description Not this one.
filter { decide pass; }
`);

  assertEquals(meta.description, "The real one.");
});

test("a policy that says nothing has empty metadata", () => {
  assertEquals(parseMeta("filter { decide pass; }"), { description: null, patches: null, severity: null, cves: [], tags: [], knobs: {} });
});
