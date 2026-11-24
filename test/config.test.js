import { assertEquals } from "yeet:assert";

import { config } from "#/config.js";

const { test } = yeet;

test("defaults attach to loopback and keep the state under /var/lib", () => {
  assertEquals(config({ _: [] }, "/srv/pfw"), {
    ifaces: ["lo"],
    object: "/srv/pfw/bin/vm.bpf.o",
    base: "/srv/pfw",
    stateFile: "/var/lib/pfw/state.js",
  });
});

test("flags arrive as yeet parses them", () => {
  const parsed = config({ _: [], iface: "eth0, eth1", state_file: "/tmp/s.js" }, "/srv/pfw");

  assertEquals(parsed.ifaces, ["eth0", "eth1"]);
  assertEquals(parsed.stateFile, "/tmp/s.js");
});
