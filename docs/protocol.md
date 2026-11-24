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
| `interfaces` | | the host's interfaces, the attached ones marked |
| `attach` | `<name>[,<name>...]` | attach to these as well |
| `detach` | `<name>[,<name>...]` | let go of these |
| `apply` | `<bytes> <name>` then the source | compile a policy and enforce it |
| `clear` | | stop enforcing |
| `shadow`, `unshadow` | | the dry run, on and off |
| `check` | `<count> [<first>]` then the sources | compile policies and change nothing |
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
  `<first>` is the number the list starts at, for a filtered list that keeps
  the numbering of the whole one.
- The knob verbs take `1` when a source follows (the policy they are about)
  and `0` when they mean the policy in place.

A policy's name is `<remote>:<path>@<rev>`, or a file path.

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

The keeper gives the firewall 20 seconds to answer a command, then refuses
the request. `pfw` gives the whole exchange 30.

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
