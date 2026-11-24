/* What a policy says about itself: `@key value` lines in the comment block
 * that opens its source.
 *
 *   // @description Resets connections that carry a JNDI lookup string.
 *   // @patches Apache Log4j 2.0-beta9 to 2.14.1
 *   // @cve CVE-2021-44228, CVE-2021-45046
 *   // @severity critical
 *   // @tags http, rce
 *   // @knob port  The port to guard.
 *
 * The block ends at the first line that is not a comment. A `@description`
 * or `@patches` given twice continues the first; `@cve` and `@tags` take
 * several, separated by commas or spaces, on one line or many. `@knob NAME`
 * says what one of the policy's knobs is for. Any other
 * key, and any comment that is not a `@key` line, is the author's own.
 */
const FIELD = /^\/\/\s*@([a-z]+)\s+(.*\S)\s*$/;

const TEXT = { description: "description", patches: "patches", severity: "severity" };
const LISTS = { cve: "cves", cves: "cves", tag: "tags", tags: "tags" };

export const SEVERITIES = ["critical", "high", "medium", "low"];

const items = (value) => value.split(/[\s,]+/).filter(Boolean);

export function parseMeta(source) {
  const meta = { description: null, patches: null, severity: null, cves: [], tags: [], knobs: {} };

  for (const line of source.split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    if (!text.startsWith("//")) break;

    const [, key, value] = text.match(FIELD) ?? [];
    if (key === "knob") {
      const [, name, about = ""] = value.match(/^(\S+)\s*(.*)$/);
      meta.knobs[name] = about;
    } else if (key in LISTS) meta[LISTS[key]].push(...items(value));
    else if (key in TEXT) meta[TEXT[key]] = meta[TEXT[key]] ? `${meta[TEXT[key]]} ${value}` : value;
  }

  meta.severity = meta.severity?.toLowerCase() ?? null;
  meta.cves = meta.cves.map((cve) => cve.toUpperCase());
  return meta;
}
