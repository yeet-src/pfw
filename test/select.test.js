import { assert, assertEquals } from "yeet:assert";

import { catalog } from "#/ctl/render/catalog.js";
import { palette } from "#/ctl/render/palette.js";
import { isFiltering, parseFilters, select } from "#/ctl/select.js";

const { test } = yeet;

const meta = (description, tags, severity = null, cves = [], patches = null) => ({ description, tags, severity, cves, patches, knobs: {} });

const ENTRIES = [
  { number: 1, name: "rules:apps/confluence.pfc@a1", ok: true, rules: [], errors: [], meta: meta("Resets the Remote API.", ["http", "java", "rce"], "critical", ["CVE-2026-90436"], "Atlassian Confluence") },
  { number: 2, name: "rules:http/crawlers.pfc@a1", ok: true, rules: [], errors: [], meta: meta("Resets AI crawlers.", ["http", "crawlers"]) },
  { number: 3, name: "rules:runtimes/log4shell.pfc@a1", ok: true, rules: [], errors: [], meta: meta("Resets Log4j lookups.", ["http", "java", "rce", "log4j"], "critical", ["CVE-2021-44228"], "Apache Log4j") },
  { number: 4, name: "rules:runtimes/tomcat.pfc@a1", ok: true, rules: [], errors: [], meta: meta("Path hardening.", ["http", "java", "tomcat"], "medium") },
  { number: 5, name: "mine:edge/waf.pfc@b2", ok: true, rules: [], errors: [], meta: meta("Our own.", ["http"]) },
];

const numbers = (...words) => select(ENTRIES, parseFilters(words)).map((e) => e.number);

const throws = (fn, text) => {
  try {
    fn();
  } catch (error) {
    return assert(error.message.includes(text), error.message);
  }
  throw new Error(`Expected a refusal holding "${text}"`);
};

test("no filters keep everything", () => {
  assertEquals(numbers(), [1, 2, 3, 4, 5]);
  assertEquals(isFiltering(parseFilters([])), false);
});

test("a tag chooses the policies that carry it, and two tags those that carry both", () => {
  assertEquals(numbers("tag=java"), [1, 3, 4]);
  assertEquals(numbers("tag=java", "tag=rce"), [1, 3]);
  assertEquals(numbers("tag=JAVA"), [1, 3, 4]);
});

test("a severity chooses that level, and two either", () => {
  assertEquals(numbers("severity=critical"), [1, 3]);
  assertEquals(numbers("severity=critical", "severity=medium"), [1, 3, 4]);
});

test("a word is looked for in the name, description, CVEs, tags and what is patched", () => {
  assertEquals(numbers("q=log4j"), [3]);
  assertEquals(numbers("q=cve-2026-90436"), [1]);
  assertEquals(numbers("q=atlassian"), [1]);
  assertEquals(numbers("q=crawlers"), [2]);
  assertEquals(numbers("q=resets", "q=java"), [1, 3]);
});

test("a remote chooses its own, and filters combine", () => {
  assertEquals(numbers("remote=mine"), [5]);
  assertEquals(numbers("remote=rules", "tag=java", "severity=critical"), [1, 3]);
  assertEquals(isFiltering(parseFilters(["remote=rules"])), true);
});

test("a filter that is not one is refused", () => {
  throws(() => parseFilters(["tags=java"]), "Unknown filter: tags=java");
  throws(() => parseFilters(["java"]), "Unknown filter: java");
});

test("the list is in groups by directory, naming the remote when there are several", () => {
  const text = catalog({ entries: ENTRIES, total: 5, active: null }, palette(false)).split("\n").filter((line) => !line.startsWith("      "));

  assertEquals(text, [
    "rules · apps",
    "  1 ✔ rules:apps/confluence.pfc     0 rules",
    "",
    "rules · http",
    "  2 ✔ rules:http/crawlers.pfc       0 rules",
    "",
    "rules · runtimes",
    "  3 ✔ rules:runtimes/log4shell.pfc  0 rules",
    "  4 ✔ rules:runtimes/tomcat.pfc     0 rules",
    "",
    "mine · edge",
    "  5 ✔ mine:edge/waf.pfc             0 rules",
  ]);
});
