# Command reference

```
pfw [--json | --color | --no-color] COMMAND [ARGS]
```

`pfw help` prints a summary, with your own settings filled in.

A **POLICY** is its number in `pfw ls`, or `name:path`
(`rules:http/crawlers.pfc`), or the path alone when you have one remote.

A **TIME** is a number and `s`, `m` or `h`: `90s`, `10m`, `1h`.

A **PLACE** is where a policy goes when several are in place at once. With
none named it is the default: for every packet no route claims.

| flag | the place |
|---|---|
| `--port [PROTO/]PORT` | a route: the packets to that port. `tcp` unless said: `--port 8443`, `--port udp/53` |
| `--proto PROTO` | a route: `tcp`, `udp`, or a protocol's number |
| `--dst ADDRESS[/LEN]` | a route: the packets to that address or prefix, IPv4 or IPv6 |
| `--iface IFACE` | a route: the packets arriving on that interface, which pfw must be attached to |
| `--first` | on every packet, before its own policy |
| `--default` | the default, for `pfw clear` to clear it alone |

The route flags combine into one route: `--dst 10.1.2.3 --port 22`. See
[Several policies at once](policies.md#several-policies-at-once).

Commands marked **saved** record what they changed, so a restart comes back
to it.

## The firewall

### `pfw up`

Makes the firewall service match the installed version, creating it if it is
missing, and starts it. Safe to run when it is already up: nothing restarts
unless the installed version changed, in which case it says so first.

### `pfw down`

Stops the firewall. Nothing is filtered until `pfw up`.

### `pfw restart`

`down`, then `up`. It comes back on the same interfaces with the same policy,
knobs and shadow mode. Counters, tracked connections and bans start over.

### `pfw status`

Whether it is up, the interfaces, the policies in place, the knobs you have
set, packet counts by verdict, and the busiest rules. Exits non-zero when the
firewall is down or does not answer.

### `pfw doctor`

Checks everything pfw depends on and says how to fix what is not right. Exits
non-zero when something has to be fixed. See
[Troubleshooting](troubleshooting.md).

### `pfw metrics`

On a terminal, the dashboard. Otherwise, a page of text. See
[Metrics](metrics.md).

### `pfw setup [--iface IFACE] [--policy POLICY] [--knob NAME=VALUE]... [--yes]` — saved

From a fresh install to a policy rehearsing, asking as it goes:

1. starts the firewall if it is down, and turns shadow mode on;
2. lists the interfaces and asks which to filter, suggesting the one the
   default route uses; attaches to it and lets go of the others;
3. pulls the remotes, lists the policies and asks which. A word narrows the
   list and asks again; Enter leaves the policy for later;
4. shows the policy's knobs and asks for values;
5. applies the policy, in shadow mode.

Nothing it does blocks anything, and it ends by saying how to enforce. An
option answers its question in advance; `--yes` takes the suggestion for
every question not answered, and asks nothing. It can be run again.

### `pfw logs`

Follows what the firewall says, as it says it: what it restored when it
started, each change it was asked for, and a trial going back. Ctrl-C
leaves, and the firewall keeps running. It keeps no history, so this is from
now on; to see a start, run it and `pfw restart` from another terminal.

### `pfw upgrade [--force]`

Moves to the latest release: downloads it, replaces the command and the
service's files, and restarts the firewall onto it. Says so and does nothing
when you already have the latest; `--force` installs it again anyway.

### `pfw uninstall [--yes] [--purge]`

Stops the firewall and removes pfw: the service, the command, the service's
files, the shell completions and the saved state. It lists what it will
remove and asks first; `--yes` does not ask. Your settings, remotes and
pulled policies are kept unless you add `--purge`. yeet is left installed.

## Interfaces

### `pfw interfaces`

Lists the machine's interfaces: which pfw is attached to, each one's state
and addresses, which the default route goes through, and which another XDP
program already holds. Ends with the command to attach to the one traffic
from the network arrives on, when pfw is not on it. `pfw ifaces` is the same,
and so is `pfw attach` with nothing after it.

### `pfw attach IFACE...` — saved

Attaches to these interfaces as well. Name them with spaces between, or
commas: `pfw attach eth0 eth1`.

### `pfw detach IFACE...` — saved

Lets go of these interfaces. Detaching the last leaves pfw running and
filtering nothing.

See [Interfaces](interfaces.md).

## Policy repositories

### `pfw remote ls`

The remotes, their URLs, and the commit each is at.

### `pfw remote add NAME URL [-r REF]`

Names a git repository of policies. `REF` is a branch, tag or commit; without
it, the repository's default branch.

### `pfw remote rm NAME`

Forgets a remote and deletes pfw's copy of it.

### `pfw pull [NAME]`

Fetches one remote, or all, and says what changed. Changes nothing about what
is running.

### `pfw ls [NAME] [WORD...] [--tag TAG] [--severity LEVEL] [--check]`

Lists the policies, in groups by directory: number, name, description, CVEs,
severity, tags and knobs, with the one in place marked. It reads each
policy's opening comments and does not compile it, so it is quick however
many there are.

`--check` (`-c`) compiles each one as well, and adds whether it is sound, how
many rules it has and what each knob holds. `pfw apply` compiles the policy it
is given either way, and refuses one that does not compile.

Narrowed by a remote's `NAME`; by any `WORD`, looked for in the name,
description, CVEs, tags and what is patched; by `--tag` (`-t`); and by
`--severity` (`-s`). They combine. A policy keeps its number however the
list is narrowed.

See [Using policies](policies.md).

## The policy in place

### `pfw apply [POLICY]` — saved

Checks a policy and puts it in place, replacing the one that was. With no
policy named, on a terminal, it lists them and asks. `pfw load` is the same
command.

### `pfw apply -f FILE` — saved

The same, from a file.

### `pfw apply POLICY PLACE` — saved

Puts the policy in a place of its own, beside the ones in the other places.
On a route it replaces the policy that route had. With `--first` it joins
the end of the chain run first, or replaces itself there if it is already
in it.

### `pfw clear` — saved

Removes every policy. Everything passes.

### `pfw clear PLACE` — saved

Removes what is in that place: one route's policy, the whole chain run
first, or with `--default` the default. The other policies go on. Fails
when nothing is there.

### `pfw shadow` — saved

Turns on the dry run: verdicts are counted, nothing is blocked.

### `pfw enforce` — saved

Turns it off: verdicts are enforced.

### `pfw enforce --confirm [TIME]`, `pfw apply POLICY --confirm [TIME]`

The same, **on trial**: the change is made now and undone after `TIME`
(`10m` when left out) unless `pfw confirm` comes first. What is saved is
what was running before, until it is confirmed.

### `pfw confirm` — saved

Keeps what is on trial. Fails when nothing is.

### `pfw rollback` — saved

With a trial pending, undoes it now. Otherwise puts back the policies as
they were before the last change, each in its place; a second `rollback`
returns.

See [On trial](policies.md#on-trial).

## Knobs

### `pfw knob ls [POLICY]`

The knobs of a policy: what each holds, whether you set it, what it is for.
Without `POLICY`, every policy in place, each with where it is.

### `pfw knob set [POLICY] NAME VALUE` — saved

Sets a knob for that policy. On a policy in place it takes effect on the
next packet. Without `POLICY`, it is the policy in place that has a knob of
that name; when several do, name one.

### `pfw knob unset [POLICY] NAME` — saved

Puts a knob back to the policy's default.

See [Knobs](knobs.md).

## Settings

### `pfw config ls`

Every setting, its value, and whether it is the default, set, or from the
environment. `pfw config` alone does the same.

### `pfw config get KEY`

One setting's value.

### `pfw config set KEY VALUE`

Sets it.

### `pfw config unset KEY`

Back to the default.

The keys are `url`, `service`, `source`, `cache` and `yeet`. See
[Configuration](configuration.md).

## Options

| option | effect |
|---|---|
| `--json` | print the firewall's reply as JSON |
| `--color` | color even when the output is not a terminal |
| `--no-color` | never color; the `NO_COLOR` environment variable does the same |
| `-h`, `--help` | the summary |

They go before the command: `pfw --json status`.

## Tab completion

Installed with pfw, for bash and zsh: commands, options, interfaces,
remotes, policies by name and a policy's knobs. Open a new shell after
installing. bash needs the `bash-completion` package, which most systems
have.

## Exit status

| status | meaning |
|---|---|
| 0 | it worked |
| 1 | it did not: the firewall refused, is down, or `doctor` found something to fix |
| 2 | the command was not understood; the summary is printed |
