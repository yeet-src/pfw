/* The host's interfaces, from the system graph: XDP attaches by ifindex,
 * people name them.
 */
const QUERY = `{ network_interfaces { name index is_up is_loopback ipv4 { cidr } } }`;

export async function listInterfaces() {
  const reply = await yeet.graph.query(QUERY);
  if (reply?.errors?.length) throw new Error(`Interface query failed: ${reply.errors.map((e) => e.message).join("; ")}`);
  return (reply?.data?.network_interfaces ?? []).map((i) => ({
    name: i.name,
    index: Number(i.index),
    up: Boolean(i.is_up),
    loopback: Boolean(i.is_loopback),
    addresses: (i.ipv4 ?? []).map((address) => address.cidr),
  }));
}

// Each wanted entry is an interface name or a bare ifindex.
export async function resolveInterfaces(wanted) {
  const known = await listInterfaces();

  return wanted.map((want) => {
    const found = known.find((i) => i.name === want || String(i.index) === want);
    if (!found) throw new Error(`No such interface: ${want} (have ${known.map((i) => i.name).join(", ")})`);
    return { name: found.name, index: found.index };
  });
}
