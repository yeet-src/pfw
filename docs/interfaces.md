# Interfaces

An *interface* is one of the machine's network connections. pfw filters the
traffic arriving on the interfaces it is **attached** to, and nothing else.

## Seeing them

```sh
pfw attach
```

```
▸ lo        ifindex 1   up   attached
  eth0      ifindex 2   up
  docker0   ifindex 3   down
```

| name you may see | what it usually is |
|---|---|
| `lo` | loopback: the machine talking to itself |
| `eth0`, `ens5`, `enp1s0` | a wired or virtual network card: the one facing the network |
| `wlan0`, `wlp2s0` | wifi |
| `docker0`, `br-…`, `veth…` | bridges and links made for containers |

`▸` and `attached` mark the ones pfw is on.

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

## One policy for all of them

pfw runs one policy, on every interface it is attached to. Different policies
on different interfaces is not something it does today.
