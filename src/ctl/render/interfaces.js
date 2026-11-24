/* The host's interfaces as `pfwctl attach` lists them, the attached ones
 * marked.
 */
export function interfaces({ available, attached }, p) {
  const width = Math.max(...available.map((i) => i.name.length));

  return available.map((i) => {
    const isAttached = attached.includes(i.name);
    return [
      isAttached ? p.ok("▸") : " ",
      (isAttached ? p.strong : p.name)(i.name.padEnd(width)),
      p.label(`ifindex ${String(i.index).padEnd(3)}`),
      i.up ? p.value("up  ") : p.warn("down"),
      isAttached ? p.ok("attached") : "",
    ].join(" ").trimEnd();
  }).join("\n");
}
