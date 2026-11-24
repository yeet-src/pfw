/* Which policies a listing shows. Every policy is checked and numbered, and
 * the filters then choose among them, so a number means the same policy
 * however the list was narrowed.
 *
 *   remote=<name>     the policies of one remote
 *   tag=<tag>         carrying this tag; given twice, both
 *   severity=<level>  of this severity; given twice, either
 *   q=<word>          with this word in its name, description, what it
 *                     patches, a CVE or a tag; given twice, both
 */
import { splitName } from "#/fw/name.js";

const KEYS = ["remote", "tag", "severity", "q"];

// `key=value` words into `{ key: [values] }`, lowercased. Anything else is refused.
export function parseFilters(words) {
  const filters = Object.fromEntries(KEYS.map((key) => [key, []]));
  for (const word of words) {
    const [, key, value] = word.match(/^([a-z]+)=(.+)$/) ?? [];
    if (!KEYS.includes(key)) throw new Error(`Unknown filter: ${word} (${KEYS.map((k) => `${k}=`).join(", ")})`);
    filters[key].push(value.toLowerCase());
  }
  return filters;
}

export const isFiltering = (filters) => KEYS.some((key) => filters[key].length > 0);

// Everything about a policy a word can be looked for in.
function haystack({ name, meta }) {
  return [splitName(name).source, meta?.description, meta?.patches, ...(meta?.cves ?? []), ...(meta?.tags ?? [])]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function matches(entry, { remote, tag, severity, q }) {
  const source = splitName(entry.name).source.toLowerCase();
  const tags = (entry.meta?.tags ?? []).map((t) => t.toLowerCase());
  const text = haystack(entry);

  return (remote.length === 0 || remote.some((r) => source.startsWith(`${r}:`)))
    && tag.every((t) => tags.includes(t))
    && (severity.length === 0 || severity.includes(entry.meta?.severity ?? ""))
    && q.every((word) => text.includes(word));
}

export const select = (entries, filters) => entries.filter((entry) => matches(entry, filters));
