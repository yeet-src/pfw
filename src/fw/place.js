/* Where a policy is put. The firewall runs several at once, each in a place
 * of its own:
 *
 *   default   every packet no route claims
 *   first     a chain every packet runs before its own policy, in order
 *   a route   the packets to one protocol, port, destination or interface
 *
 * A place travels as one word, its spec, in a request and in the saved
 * state: `default`, `first`, or a route's parts with commas between.
 *
 *   tcp/8443                  a port
 *   udp                       a protocol
 *   10.1.0.0/16               a destination, v4 or v6
 *   10.1.2.3,tcp/22,if=eth0   any of them together, and an interface
 *
 * Pure: an interface is looked up among the ones handed in.
 */
const PROTOCOLS = { tcp: 6, udp: 17 };
const MAX_PORT = 65535;

const notAddress = (text) => new Error(`A destination is an address or a CIDR, like 10.1.0.0/16: ${text} is not one`);

function parse4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.map(Number);
}

function parse6(ip) {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const [head, tail] = halves.map((half) => (half === "" ? [] : half.split(":")));
  const gap = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(0, gap)).fill("0"), ...(tail ?? [])];
  if (groups.length !== 8 || (halves.length === 2 && gap < 1) || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.flatMap((group) => [parseInt(group, 16) >> 8, parseInt(group, 16) & 0xff]);
}

// Eight groups with the longest run of zero groups, if two or more, as `::`.
function format6(bytes) {
  const groups = Array.from({ length: 8 }, (_, i) => ((bytes[2 * i] << 8) | bytes[2 * i + 1]).toString(16));

  let best = { at: -1, length: 1 };
  for (let at = 0; at < 8; at++) {
    let length = 0;
    while (at + length < 8 && groups[at + length] === "0") length++;
    if (length > best.length) best = { at, length };
  }
  if (best.at < 0) return groups.join(":");
  return `${groups.slice(0, best.at).join(":")}::${groups.slice(best.at + best.length).join(":")}`;
}

/* An address or CIDR as the one text that names its prefix: the bits past
 * the prefix zeroed and the length always said, so `10.1.2.3/16` and
 * `10.1.0.0/16` are the same route here as they are in the kernel.
 */
export function canonicalPrefix(text) {
  const [ip, length, ...more] = String(text).split("/");
  const v6 = ip.includes(":");
  const bytes = v6 ? parse6(ip) : parse4(ip);
  if (!bytes || more.length > 0 || (length !== undefined && !/^\d{1,3}$/.test(length))) throw notAddress(text);

  const prefix = length === undefined ? bytes.length * 8 : Number(length);
  if (prefix > bytes.length * 8) throw notAddress(text);

  const masked = bytes.map((byte, i) => byte & (0xff << (8 - Math.max(0, Math.min(8, prefix - i * 8)))) & 0xff);
  return `${v6 ? format6(masked) : masked.join(".")}/${prefix}`;
}

// `tcp`, `udp/53`, `47`: a protocol by name or number, and a port of it.
function parsePorts(text) {
  const [, name, port] = text.match(/^([a-z]+|\d+)(?:\/(\d+))?$/i) ?? [];
  const proto = PROTOCOLS[name?.toLowerCase()] ?? (/^\d+$/.test(name ?? "") ? Number(name) : null);
  if (proto === null || proto < 1 || proto > 255) throw new Error(`A protocol is tcp, udp or a number from 1 to 255: ${text} is not one`);
  if (port !== undefined && (Number(port) < 1 || Number(port) > MAX_PORT)) throw new Error(`A port is a number from 1 to ${MAX_PORT}: ${port} is not one`);
  return { proto, dport: port === undefined ? null : Number(port) };
}

const protocolName = (proto) => Object.keys(PROTOCOLS).find((name) => PROTOCOLS[name] === proto) ?? String(proto);

export class Route {
  #iface;
  #proto;
  #dport;
  #dst;

  // `iface` is `{ name, index }`; a part the route does not name is null.
  constructor({ iface = null, proto = null, dport = null, dst = null }) {
    if (iface === null && proto === null && dst === null) throw new Error("A route names a port, a protocol, a destination or an interface");
    this.#iface = iface;
    this.#proto = proto;
    this.#dport = dport;
    this.#dst = dst;
  }

  get iface() {
    return this.#iface;
  }

  get #ports() {
    if (this.#proto === null) return null;
    return this.#dport === null ? protocolName(this.#proto) : `${protocolName(this.#proto)}/${this.#dport}`;
  }

  // What a person reads: `10.1.0.0/16 tcp/22 on eth0`.
  get label() {
    return [this.#dst, this.#ports, this.#iface && `on ${this.#iface.name}`].filter(Boolean).join(" ");
  }

  // The word that parses back to this route, and tells two routes apart.
  get spec() {
    return [this.#dst, this.#ports, this.#iface && `if=${this.#iface.name}`].filter(Boolean).join(",");
  }

  // What `PfwVm.route` and `PfwVm.unroute` take.
  get match() {
    return {
      ...(this.#iface && { iface: this.#iface.index }),
      ...(this.#proto !== null && { proto: this.#proto }),
      ...(this.#dport !== null && { dport: this.#dport }),
      ...(this.#dst && { dst: this.#dst }),
    };
  }

  // The name `PfwVm.stats().routes` counts this route's program under.
  get counted() {
    return [this.#dst, this.#iface && `if${this.#iface.index}`, this.#ports].filter(Boolean).join(" ");
  }
}

export const DEFAULT = Object.freeze({ kind: "default", spec: "default", label: "default" });
export const FIRST = Object.freeze({ kind: "first", spec: "first", label: "first" });

export const routePlace = (route) => Object.freeze({ kind: "route", spec: route.spec, label: route.label, route });

/* A spec as a place. `interfaces` are the ones a route may name, each
 * `{ name, index }`: a route for an interface the firewall is not on would
 * never see a packet.
 */
export function parsePlace(spec, interfaces = []) {
  if (spec === DEFAULT.spec) return DEFAULT;
  if (spec === FIRST.spec) return FIRST;

  const parts = { iface: null, proto: null, dport: null, dst: null };
  const once = (key, what) => {
    if (parts[key] !== null) throw new Error(`A route names one ${what}: ${spec} names two`);
  };

  for (const word of String(spec).split(",").filter(Boolean)) {
    if (word.startsWith("if=")) {
      once("iface", "interface");
      const wanted = word.slice(3);
      parts.iface = interfaces.find((i) => i.name === wanted || String(i.index) === wanted) ?? null;
      if (!parts.iface) throw new Error(`Not attached to ${wanted}: a route names an interface the firewall is on (pfw attach ${wanted})`);
    } else if (/[.:]/.test(word)) {
      once("dst", "destination");
      parts.dst = canonicalPrefix(word);
    } else {
      once("proto", "protocol");
      Object.assign(parts, parsePorts(word));
    }
  }

  return routePlace(new Route(parts));
}
