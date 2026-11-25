import { assert, assertEquals } from "yeet:assert";

import { atOf } from "#/ctl/request.js";
import { DEFAULT, FIRST, canonicalPrefix, parsePlace } from "#/fw/place.js";

const { test } = yeet;

const ETH0 = { name: "eth0", index: 2 };

function refuses(run, text) {
  try {
    run();
  } catch (error) {
    return assert(error.message.includes(text), error.message);
  }
  throw new Error(`Expected a refusal holding "${text}"`);
}

test("the default and the chain run first are places by name", () => {
  assertEquals(parsePlace("default"), DEFAULT);
  assertEquals(parsePlace("first"), FIRST);
});

test("a route names a port, a protocol, a destination, an interface, or several", () => {
  assertEquals(parsePlace("tcp/8443").route.match, { proto: 6, dport: 8443 });
  assertEquals(parsePlace("UDP").route.match, { proto: 17 });
  assertEquals(parsePlace("47").route.match, { proto: 47 });
  assertEquals(parsePlace("10.1.0.0/16").route.match, { dst: "10.1.0.0/16" });
  assertEquals(parsePlace("if=eth0", [ETH0]).route.match, { iface: 2 });
  assertEquals(parsePlace("10.1.2.3,tcp/22,if=eth0", [ETH0]).route.match, { iface: 2, proto: 6, dport: 22, dst: "10.1.2.3/32" });
});

test("a route says what it is for, and its spec parses back to it", () => {
  const { route, label, spec } = parsePlace("if=2,tcp/22,10.1.2.3/16", [ETH0]);

  assertEquals(label, "10.1.0.0/16 tcp/22 on eth0");
  assertEquals(spec, "10.1.0.0/16,tcp/22,if=eth0");
  assertEquals(parsePlace(spec, [ETH0]).spec, spec);
  // The name PfwVm counts the route's program under.
  assertEquals(route.counted, "10.1.0.0/16 if2 tcp/22");
  assertEquals(parsePlace("tcp/8443").route.counted, "tcp/8443");
});

test("a prefix is one text however it was written", () => {
  assertEquals(canonicalPrefix("10.1.2.3"), "10.1.2.3/32");
  assertEquals(canonicalPrefix("10.1.2.3/16"), "10.1.0.0/16");
  assertEquals(canonicalPrefix("10.1.2.3/20"), "10.1.0.0/20");
  assertEquals(canonicalPrefix("0.0.0.0/0"), "0.0.0.0/0");
  assertEquals(canonicalPrefix("2001:DB8:0:0:0:0:0:1"), "2001:db8::1/128");
  assertEquals(canonicalPrefix("2001:db8::ffff/32"), "2001:db8::/32");
  assertEquals(canonicalPrefix("::1"), "::1/128");
  assertEquals(canonicalPrefix("::/0"), "::/0");
  assertEquals(canonicalPrefix("fe80:0:0:1::/64"), "fe80:0:0:1::/64");
});

test("what is not a route is refused, and says why", () => {
  refuses(() => parsePlace("10.1.0.0/33"), "A destination is an address or a CIDR");
  refuses(() => parsePlace("10.1.0/16"), "A destination is an address or a CIDR");
  refuses(() => parsePlace("1::2::3"), "A destination is an address or a CIDR");
  refuses(() => parsePlace("tcp/0"), "A port is a number from 1 to 65535");
  refuses(() => parsePlace("tcp/70000"), "A port is a number from 1 to 65535");
  refuses(() => parsePlace("icmpx"), "A protocol is tcp, udp or a number");
  refuses(() => parsePlace("tcp/80,udp/53"), "names one protocol");
  refuses(() => parsePlace("if=eth1", [ETH0]), "Not attached to eth1");
  refuses(() => parsePlace(""), "A route names a port");
});

test("a header says where a change goes, after whether it is on trial", () => {
  assertEquals(atOf("at=tcp/8443 22 rules:a.pfc"), "tcp/8443");
  assertEquals(atOf("confirm=10m at=first 22 rules:a.pfc"), "first");
  assertEquals(atOf("at=first"), "first");
  assertEquals(atOf("22 rules:at=first.pfc"), null);
  assertEquals(atOf(""), null);
});
