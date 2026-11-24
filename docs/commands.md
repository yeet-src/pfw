# Command reference

```
pfw [--json | --color | --no-color] COMMAND [ARGS]
```

`pfw help` prints a summary, with your own settings filled in.

A **POLICY** is its number in `pfw ls`, or `name:path`
(`rules:http/crawlers.pfc`), or the path alone when you have one remote.

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

Whether it is up, the interfaces, the policy in place, the knobs you have
set, packet counts by verdict, and the busiest rules. Exits non-zero when the
firewall is down or does not answer.

### `pfw doctor`

Checks everything pfw depends on and says how to fix what is not right. Exits
non-zero when something has to be fixed. See
[Troubleshooting](troubleshooting.md).

### `pfw metrics`

On a terminal, the dashboard. Otherwise, a page of text. See
[Metrics](metrics.md).

## Interfaces

### `pfw attach`

Lists the machine's interfaces, the attached ones marked.

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

### `pfw ls [NAME]`

Lists the policies of one remote, or all: number, whether it compiles, name,
description, tags and knobs, with the one in place marked.

See [Using policies](policies.md).

## The policy in place

### `pfw apply [POLICY]` — saved

Checks a policy and puts it in place, replacing the one that was. With no
policy named, on a terminal, it lists them and asks. `pfw load` is the same
command.

### `pfw apply -f FILE` — saved

The same, from a file.

### `pfw clear` — saved

Removes the policy. Everything passes.

### `pfw shadow` — saved

Turns on the dry run: verdicts are counted, nothing is blocked.

### `pfw unshadow` — saved

Turns it off: verdicts are enforced.

## Knobs

### `pfw knob ls [POLICY]`

The knobs of a policy: what each holds, whether you set it, what it is for.
Without `POLICY`, the policy in place.

### `pfw knob set [POLICY] NAME VALUE` — saved

Sets a knob for that policy. On the policy in place it takes effect on the
next packet.

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

## Exit status

| status | meaning |
|---|---|
| 0 | it worked |
| 1 | it did not: the firewall refused, is down, or `doctor` found something to fix |
| 2 | the command was not understood; the summary is printed |
