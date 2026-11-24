/* A policy's name is `<source>@<rev>`: where it came from, and the commit
 * it was read at. A local file has no rev. The source alone is the policy's
 * key: what stays the same from one pull to the next.
 */
export function splitName(name) {
  const at = name.lastIndexOf("@");
  return at < 0 ? { source: name, rev: null } : { source: name.slice(0, at), rev: name.slice(at + 1) };
}

export const keyOf = (name) => splitName(name).source;
