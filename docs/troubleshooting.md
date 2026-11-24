# Troubleshooting

## Start with the doctor

```sh
pfw doctor
```

```
this host
  ✔ linux         kernel 6.12.73
  ✔ kernel BTF    /sys/kernel/btf/vmlinux
  ✔ git           2.47.3
yeet
  ✔ yeet          /usr/local/bin/yeet v0.25.0
  ✔ daemon        yeetd answers
the service
  ✔ build         /usr/local/share/pfw
  ✔ service       pfw is running
  ✔ control       answers at ws://127.0.0.1:9477/ctl
  ✔ version       the running service is its build
  ✔ port          listening on http://127.0.0.1:9477
the firewall
  ✔ interfaces    eth0
  ✔ policy        rules:http/crawlers.pfc @ b58a001
  ✔ saved state   /var/lib/pfw/state.js, written with sudo
policy
  ✔ remote rules  at b58a001, and https://github.com/yeet-src/pfw-rules.git answers

✔ everything pfw depends on is in place
```

- `✔` is fine.
- `▲` is worth a look, and pfw still runs.
- `✘` has to be fixed. The line under it says how.

It exits non-zero when something has to be fixed.

## What each check means

| check | when it fails |
|---|---|
| linux | this is not Linux, or the kernel is older than 6.1 |
| kernel BTF | the kernel was built without the type information pfw needs; use your distribution's standard kernel |
| git | `git` is not installed; `pfw pull` needs it |
| yeet | no `yeet` that runs is on your `PATH`; run the installer again |
| PATH | an earlier `yeet` on `PATH` does not run here; pfw skips it, your shell will not |
| login | this machine is not logged in to yeet; until it is, yeet answers for pfw with a login page |
| daemon | yeet's background service is not answering |
| build | the service's files are missing or incomplete; run the installer again |
| service | the firewall is not installed in yeet, or is stopped; `pfw up` |
| control | the firewall is running but does not answer where `pfw` is looking |
| version | you upgraded and the old firewall is still running; `pfw up` |
| port | something else is using pfw's port, or pfw is not listening on it |
| url | `pfw` is set to talk to a different port than the firewall listens on |
| exposure | the firewall is reachable from the network; see [Security](security.md) |
| interfaces | pfw is attached to none, so nothing is filtered |
| policy | no policy is in place, so everything passes |
| shadow | shadow mode is on, so nothing is blocked |
| saved state | pfw cannot write what it should remember across restarts |
| remote | a policy repository has not been pulled, or cannot be reached |

## Errors, and what to do

### `the pfw service is not reachable, or did not answer`

The firewall is not running, or `pfw` is looking in the wrong place.

```sh
pfw up
pfw doctor        # if that did not do it
```

### `another XDP program holds one of its interfaces`

Something else is attached to the interface. An interface has room for one.

```sh
ip link show eth0          # "xdp" in the output means something is attached
pfw interfaces             # the other interfaces you could use
```

Stop the other program, or attach pfw elsewhere.

### `No such interface: eth9 (have lo, eth0, …)`

The name is wrong. The message lists the real ones; `pfw interfaces` does
too.

### `this host is not logged in to yeet`

yeet does not serve anything on a machine that is not logged in: it answers
every request, pfw's included, with a login page. So the firewall can be
running and `pfw` still cannot talk to it.

```sh
yeet login
```

If it was the installer that said so, run it again afterwards.

### `the yeet daemon does not answer`

yeet's background service is not running, or you may not use it.
`yeet status` should print `Status: Ok.`

### `Policy … does not compile: line N: …`

A mistake in the policy file, at that line. Nothing changed: the policy that
was running still is. Fix the line and apply again. See
[Writing a policy](writing-policies.md).

### `which remote? pfw apply NAME:path`

You have more than one remote, so a bare path could be in any of them. Use
the number from `pfw ls`, or `name:path`.

### `no policy numbered 9 (pfw ls)`

Numbers follow the current list, and a pull can shift them. Run `pfw ls`
again.

### `No policy is enforcing: name one`

A knob command needs to know which policy you mean, and none is in place.
Name it: `pfw knob ls 2`.

### `… has no knob prot (it has: port)`

The knob name is misspelled, or belongs to another policy. The message lists
the ones this policy has.

### `not saved: … is another host`

You are driving a firewall on another machine. The change was made, and it
will be lost when that firewall restarts. See
[Configuration](configuration.md#driving-a-firewall-on-another-machine).

### `not saved: could not write …`

pfw could not write its state file, so the change will not survive a
restart. Check that `sudo` works and that `/var/lib/pfw` can be created.

### `the build changed: restarting pfw, unfiltered meanwhile`

Not an error. You upgraded, and `pfw up` is moving the firewall onto the new
version. Traffic is not filtered for the moment it takes.

## Things that go wrong without an error

### I applied a policy and nothing is blocked

In order:

1. `pfw status`: does the first line say `shadow mode`? Then `pfw unshadow`.
2. Is pfw on the right interface? `pfw interfaces`.
3. Is the traffic encrypted? pfw cannot read inside HTTPS. See
   [Security](security.md#what-pfw-does-not-see).
4. Does the policy look at the right port? `pfw knob ls`.
5. Is traffic arriving at all? `packets … seen` in `pfw status` should climb.

### I blocked something I need

```sh
pfw clear
```

Everything passes again and pfw stays up. Bans already made still stand until
they expire; `pfw restart` clears them.

### I changed something and it did not survive a restart

pfw saves its state after each change and prints
`✔ saved for restarts at …`. If you saw `▲ not saved` instead, that change
was not kept.

### The numbers in `pfw ls` changed

A pull added or removed a policy. Use `name:path` where it matters.

### `pfw metrics` prints text instead of the dashboard

The dashboard opens only on a terminal. Through a pipe, in a script, or with
`--no-color` or `--json`, you get the text page.

### Something hangs

No command waits more than 30 seconds for the firewall. If one gives up, the
firewall has stopped answering: `pfw restart`.

### `pfw status` shows an `unread` line

Segments arrived larger than the 2 KB the engine reads, and the rest of each
passed uninspected. It happens on `lo`, where a segment can be 64 KB. A
policy that looks for text can be walked past this way. Attach pfw to the
interface traffic arrives on instead. See
[What pfw does not see](security.md#what-pfw-does-not-see).

### Applying a policy reset my open connections

The first time a policy that reassembles streams is applied, connections
already open on the port it guards are reset once. See
[Applying](policies.md#applying).

### The blocked count is higher than the number of requests

The counts are packets. See
[What the numbers count](metrics.md#what-the-numbers-count).

### I enforced a policy and a while later it was rehearsing again

It was on trial (`--confirm`) and nobody ran `pfw confirm`, so the firewall
undid it at the deadline. `pfw status` says so: `not confirmed: went back …
ago`. Enforce it again and confirm it once you have checked that everything
still works.

### `Nothing is on trial: there is nothing to confirm`

The trial already ran out, or there was none. `pfw status` says which.

### `There is nothing to roll back to`

No policy has been applied or cleared since pfw was installed, so there is
no policy before this one.

## Getting more out of it

`pfw logs` follows what the firewall says as it says it: what it restored at
start, every change it is asked for, and a trial going back. It keeps no
history, so to watch a start, leave it running and `pfw restart` from another
terminal.

```sh
pfw --json status      # everything the firewall knows, for a bug report
yeet service tree pfw  # the service's parts, as yeet sees them
```
