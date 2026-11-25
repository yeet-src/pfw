# Interfaces

An *interface* is one of the machine's network connections. pfw filters the
traffic arriving on the interfaces it is **attached** to, and nothing else.

## Seeing them

```sh
pfw interfaces
```

```
▸  lo       up    127.0.0.1/8      attached  loopback: this machine talking to itself
   eth0     up    203.0.113.7/24             default route: traffic from the network arrives here
   eth1     up    10.0.0.5/24
   docker0  down  172.17.0.1/16              down: nothing arrives here

to filter traffic from the network: pfw attach eth0
```

Each line is an interface: its name, whether it is up, its addresses, and
what it is.

- **`▸ … attached`** marks the ones pfw is on.
- **`default route`** marks the one this machine reaches the rest of the
  network through. Traffic from outside arrives there, so **that is usually
  the one to attach to**, and the last line gives you the command.
- **`another XDP program is on it`** means pfw cannot attach there: an
  interface has room for one.

Which one do you want?

| you want to filter | attach to |
|---|---|
| traffic from the internet or your network | the `default route` interface |
| traffic on a second network (a private subnet, a VPN) | the interface with that network's address |
| traffic between programs on this machine | `lo` |
| traffic to containers | the bridge they sit behind (`docker0`, `br-…`) |

Names you may see:

| name | what it usually is |
|---|---|
| `lo` | loopback: the machine talking to itself. A content policy here that does not reassemble can be walked past with a large request: see [What pfw does not see](security.md#what-pfw-does-not-see) |
| `eth0`, `ens5`, `enp1s0` | a wired or virtual network card |
| `wlan0`, `wlp2s0` | wifi |
| `docker0`, `br-…`, `veth…` | bridges and links made for containers |
| `tun0`, `wg0`, `tailscale0` | a VPN |

`pfw attach` with no interface named prints the same list.

## Attaching and detaching

```sh
pfw attach eth0          # add one
pfw attach eth0 eth1     # or several (eth0,eth1 works too)
pfw detach lo            # let one go
```

`attach` adds to the set; `detach` takes away from it. A fresh install is on
`lo` only, so the usual first move is to attach the real interface and detach
`lo`.

What happens when the set changes:

- **The policy carries over.** It is enforced on the new set at once.
- **Counters, tracked connections and bans start over.** pfw has to release
  its hold on the interfaces and take it again.
- **If the new set cannot be taken, nothing changes.** pfw goes back to where
  it was and tells you why: no such interface, or something else already
  holds it.
- **It is remembered.** After a restart or a reboot pfw comes back on the
  same interfaces.

## One program per interface

pfw attaches to an interface through a part of Linux called XDP, and an
interface has room for exactly one XDP program. So:

- while pfw is on `eth0`, nothing else can attach to `eth0` that way, and
- if something else already has, `pfw attach eth0` fails with
  `another XDP program holds one of its interfaces`.

`ip link show eth0` shows `xdp` in its output when something is attached.

## Detached from everything

```sh
pfw detach eth0     # the last one
```

```
● pfw  up 2m   on no interface: nothing is filtered
  policy   rules:http/crawlers.pfc @ b58a001   held: no interface to enforce on
```

pfw stays running and keeps its policy, and filters nothing. Attach an
interface and the policy is enforced again. This is a way to step aside
without losing your setup; `pfw down` stops pfw altogether.

## A policy for one of them

A policy is for every interface pfw is attached to, unless you say
otherwise: `pfw apply POLICY --iface eth1` gives the packets arriving on
`eth1` a policy of their own. See
[Several policies at once](policies.md#several-policies-at-once).
