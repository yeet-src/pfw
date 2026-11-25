# Control protocol

What `pfw` says to the firewall on `/ctl`. You need this only to write
another client; `pfw --json` is the easier way to script.

## Transport

`/ctl` is a WebSocket on the service's address. `pfw` reaches it with
`yeet dial`:

```sh
printf 'status\n' | yeet dial ws://127.0.0.1:9477/ctl
```

**One command per connection.** The client sends a request, the service
sends one reply and closes.

Requests are a byte stream: message boundaries mean nothing, because
`yeet dial` forwards a pipe in whatever chunks it read. So a request is
framed by its header line and by byte counts.

## Requests

A header line, ending in a newline:

```
[@<format> ]<verb>[ <arguments>]
```

`<format>` is `json` (the default), `tty` or `plain`.

| verb | arguments | does |
|---|---|---|
| `status` | | the firewall's state and main counters |
| `metrics` | | everything it has counted, and the speeds |
| `interfaces` | `[default=<names>] [xdp=<names>]` | the host's interfaces, the attached ones marked; the client says which the default route uses and which hold an XDP program, since the service cannot see either |
| `attach` | `<name>[,<name>...]` | attach to these as well |
| `detach` | `<name>[,<name>...]` | let go of these |
| `apply` | `[confirm=<time> ][at=<place> ]<bytes> <name>` then the source | compile a policy and enforce it: as the default, or at a place |
| `clear` | `[at=<place>]` | stop enforcing; with a place, only what is there |
| `shadow` | | the dry run, on |
| `enforce` | `[confirm=<time>]` | the dry run, off |
| `confirm` | | keep what is on trial |
| `rollback` | | undo the trial; with none, back to the policies before the last change |
| `check` | `<count> [<filter>...]` then the sources | compile policies, change nothing, and list those the filters choose |
| `knobs` | `<0\|1>` | a policy's knobs |
| `knob-set` | `<0\|1> <knob> <value>` | set one |
| `knob-unset` | `<0\|1> <knob>` | back to its default |
| `saved` | | the firewall's state, as a module to keep |

### Sources

A policy travels as a line saying how long it is and what it is called, then
exactly that many bytes:

```
<bytes> <name>
<bytes of pfw-C>
```

- `apply` puts the `<bytes> <name>` on its own header line, and the source
  follows.
- `check <count>` is followed by `<count>` sources, each with its own line.
  Every one is compiled and numbered by its place; the filters then choose
  which are listed, so a number means the same policy however the list was
  narrowed. A filter is `remote=<name>`, `tag=<tag>`, `severity=<level>` or
  `q=<word>`; `tag` and `q` given twice need both, `remote` and `severity`
  either.
- The knob verbs take `1` when a source follows (the policy they are about).
  With `0`, `knobs` lists every policy in place, and `knob-set` and
  `knob-unset` mean the one in place that has the knob, which must be one
  policy's alone. A `knobs` reply carries `"policies"`, one entry for each
  listed, with `"at"`, the places it is in; the first entry's fields are
  also the reply's own.

A policy's name is `<remote>:<path>@<rev>`, or a file path.

### Places

Several policies are in place at once, each in a place of its own.
`at=<place>` says which; without it, the default. A place is one word:

| place | is |
|---|---|
| `default` | every packet no route claims |
| `first` | the chain every packet runs before its own policy; `apply` adds to its end, `clear` empties it |
| a route | the packets it names, as parts with commas between |

A route's parts, each at most once: `<proto>` or `<proto>/<port>` (`tcp`,
`udp/53`, or a protocol's number), an address or CIDR (`10.1.0.0/16`,
`2001:db8::/32`), and `if=<interface>`, by name or index, which the
firewall must be attached to. `at=10.1.2.3,tcp/22,if=eth0` is one route.

A status reply lists every policy in place as `"policies"`, each with
`"at"` (`default`, `first`, `first.1`, or the route as status prints it)
and `"place"` (`default`, `first` or `route`). `"policy"` is the default
alone, or null. `"programs"` is what each has counted, by the same `"at"`.

`confirm=<time>` puts the change on trial: it is undone after that long
unless `confirm` comes first. `<time>` is a number and `s`, `m` or `h`,
from `5s` to `24h`. A status reply then carries `"trial":{"until":<ms>}`;
`"lapsed_at"` is when one last ran out, and `"previous"` lists the policies
`rollback` would return to.

A source may be at most 1 MiB, a header 4096 bytes, and a `check` 1024
policies.

## Replies

### `json`

One line:

```json
{"ok":true, ...}
{"ok":false,"error":"...","errors":[{"line":3,"text":"..."}]}
```

`errors` is there when a policy did not compile. Counters are numbers.

### `tty` and `plain`

```
ok
<the rendered text>
```

or `err` on the first line. `tty` is colored with ANSI escapes; `plain` is
not. The text is what `pfw` prints.

`saved` in a text format answers the path on a line of its own, then the
module to write there.

## Timeouts

The keeper gives the firewall 90 seconds to answer a command, then refuses
the request. `pfw` gives the whole exchange 100. Nearly every command answers
at once; `attach` and `detach` load the engine into the kernel again, which
takes a few seconds on most machines and tens of seconds on some.

## The other two routes

- **`/metrics`** is plain HTTP: a GET returns the Prometheus text exposition.
- **`/ui`** is a terminal over a WebSocket, as `yeet dial` speaks it: the
  dashboard is a full-screen application, not a protocol to parse.

## Inside the service

Between the isolates and the firewall worker, messages are objects on a
`MessagePort`:

| from | message | answered with |
|---|---|---|
| keeper | `{ pfw: "init", config }` | `{ pfw: "ready" }` or `{ pfw: "failed", message }` |
| keeper | `{ pfw: "ctl", id, request }` | `{ pfw: "reply", id, text }` |
| metrics app | `{ pfw: "view" }` | `{ pfw: "view", report, stats, speeds, ruleSpeeds, window }` |
| scrape | `{ __telemetry: "snapshot" }` | `{ __telemetry: "snapshot", doc }` |

The last is `yeet:telemetry`'s own protocol, so a scrape is
`render({ worker })`.
