# Security

## pfw's port has no password

pfw listens on one address, by default `127.0.0.1:9477`, and serves three
things there:

| path | what it is | what someone who reaches it can do |
|---|---|---|
| `/metrics` | Prometheus metrics | read your traffic counts, policy name and rule names |
| `/ui` | the dashboard | the same, live |
| `/ctl` | the control route | **replace or remove your policy**, change interfaces, turn on shadow mode |

None of them asks who you are. **Anyone who can reach the port controls the
firewall.**

## The default is safe

`127.0.0.1` is this machine only. Nothing on the network can reach it. Only
people who can already run commands on the machine can, and they could do
more than change a firewall policy.

`pfw doctor` tells you if this has been opened up:

```
▲ exposure      http://0.0.0.0:9477 is every interface, and /ctl has no login
```

## If you need to reach it from elsewhere

For Prometheus on another machine, or to run `pfw` against this firewall
remotely. In order of preference:

**1. An SSH tunnel.** Nothing about pfw changes.

```sh
ssh -L 9477:127.0.0.1:9477 you@the-firewall-host
```

While that is open, `127.0.0.1:9477` on your machine is the firewall's.

**2. A private network.** Change the listen address to the machine's address
on a network only trusted machines are on (a VPN, a private subnet), not
`0.0.0.0`:

```toml
web-server = "http://10.0.0.5:9477"
```

in `/usr/local/share/pfw/service.toml`, then `pfw up`.

**3. Every interface, with a rule in front.** `0.0.0.0` puts all three paths
on every network the machine is on. Do this only with a host firewall rule
that limits who reaches port 9477.

There is no way today to open `/metrics` and keep `/ctl` closed: they share
the address.

## What pfw needs to run

- The firewall runs inside yeet's service, with the privilege to attach to
  network interfaces.
- The `pfw` command runs as you. It uses `sudo` for two things: installing
  under `/usr/local`, and writing the saved state under `/var/lib/pfw`.

## Policies are code

A policy decides what reaches your machine. One from a repository you do not
control can pass what you meant to block, or block what you need.

- Read a policy before applying it.
- Pin a remote to a tag or commit you have read:
  `pfw remote add acme URL -r v1.4.0`.
- `pfw pull` never changes what is running. A new version takes effect only
  when you `apply` it.
- Try it in shadow mode first.

A policy cannot run arbitrary code on your machine. The language is limited
on purpose, and Linux checks the engine that runs it.

## What pfw does not see

- **Encrypted contents.** Inside an HTTPS connection, pfw sees ports and
  addresses, not the request. Rules that look for text match plain traffic,
  or traffic after something has decrypted it.
- **Anything past the first 4 KB of a large segment, for a policy that does
  not follow the connection.** A policy that says `reassemble` reads every
  byte of a stream, a large segment a piece at a time. One that does not
  scans the first 4096 bytes of each packet. On a network card a segment is
  at most about 1500 bytes, so it is read whole. **On loopback (`lo`) a
  segment can be 64 KB**, and such a policy inspects only its first 4 KB: a
  request padded past that point goes through unread. This matters when
  something on the same machine decrypts HTTPS and passes the request on
  over `lo`, which is the usual place to put a content policy. Use a policy
  that reassembles there, or prefer the interface traffic arrives on.
  `pfw doctor` warns about a policy on `lo` that does not reassemble.
- **Traffic on interfaces it is not attached to.**
- **Traffic leaving the machine.** pfw filters what arrives.

When pfw cannot fully inspect something it is attached to, it counts it: see
`reassembly` and `http/2` in [Metrics](metrics.md).

## When pfw is not running

A firewall that is down filters nothing, and traffic flows as if pfw were
not there. That is true while it restarts (during an upgrade, or
`pfw restart`), and when it is attached to no interface.
`pfw status` exits non-zero when it is down; alert on `pfw_up == 0`.
