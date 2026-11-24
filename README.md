# pfw

A yeet service that enforces programmable L7 firewall policy at XDP, and
`pfwctl`, the CLI that pulls policy from git and loads it.

- **The service** embeds [`pfw-core`](https://github.com/yeet-src/pfw-core).
  The firewall is a shared worker: it owns the XDP hook of its interfaces
  through `PfwVm`, with the policy and the counters. An eager *keeper* isolate
  holds the worker alive, and a web server puts two routes on the network.
- **`/metrics`** is the firewall's counters as Prometheus text: packets by
  verdict, hits by rule, decision-time histogram, the policy now enforcing.
  Each scrape is its own short-lived isolate (per-connection tenancy) that
  asks the worker for a snapshot.
- **`/ctl`** is the control route, served by the keeper and run in the
  worker. `bin/pfwctl` is its client, over `yeet dial`.

Policy is [pfw-C](https://github.com/yeet-src/pfw-core/blob/master/docs/lang.md),
one program at a time. With none applied, the firewall passes everything.

## pfwctl

```sh
pfwctl up                                    # apply the service from its build, and start it
pfwctl status                                # is it up, what is it enforcing

pfwctl remote add acme git@github.com:acme/policy.git
pfwctl pull                                  # fetch every remote
pfwctl ls                                    # the policies, numbered, compiled

pfwctl apply acme:edge/waf.pfc               # or its number, or nothing to be asked
```

```
● pfw  up 3d 4h   on eth0
  policy   acme:edge/waf.pfc @ a1b2c3d   enforcing   applied 2h ago
  packets  1.23M seen   pass 1.19M   drop 312   rst 4.1k   ban 17
  rules    sqli 3.9k   crawler 212
```

| | |
|---|---|
| `up`, `down`, `restart` | the service's life |
| `status` | up or down, interfaces, policy, counters |
| `metrics` | everything it has counted: verdicts, rules, decision times |
| `attach [IFACE,...]`, `detach IFACE,...` | the interfaces it filters |
| `remote add NAME URL [-r REF]`, `remote ls`, `remote rm NAME` | the git repositories policies come from |
| `pull [NAME]` | fetch one remote, or all |
| `ls [NAME]` | the pulled policies |
| `apply [POLICY]`, `clear` | the policy enforcing (`load` is another name for `apply`) |
| `knob ls`, `knob set`, `knob unset` | the values a policy reads, per policy |
| `config ls`, `get`, `set`, `unset` | `pfwctl`'s own settings |

- **`up`** makes the service match its build, creating it if it is missing,
  then starts it. The build is the `source` setting, else `dist/` or
  `share/pfw` beside `pfwctl`, which covers the tree and `make install` alike.
  A changed build stops the firewall before the new one starts, since an
  interface has one XDP hook: the interfaces go unfiltered for that moment,
  and `up` says so. **`restart`** is `down` then `up`.
- **`status`** exits non-zero when the firewall is down or unreachable, so it
  is also the health check.
- **`attach`** adds interfaces and **`detach`** lets them go; `attach` alone
  lists the host's. Changing the set releases the hooks before taking the new
  ones, so flows, bans and counters start over, and the policy is enforced
  again on the new set. If an interface cannot be taken (no such interface,
  or another XDP program holds it), the firewall goes back to where it was.
  Detached from everything, it stays up and holds its policy, filtering
  nothing.
- **`pull`** says what changed in each remote since the last pull.
- **`ls`** lists every `.pfc`, numbered, with whether it compiles and which
  one is enforcing. The service does the compiling.
- **`apply`** takes `NAME:PATH`, a bare `PATH` when there is one remote, or a
  number from `ls`; `apply -f FILE` takes a local file; with nothing, it lists
  the policies and asks. The service compiles the policy and swaps it in
  atomically: flows and bans survive. One that does not compile is refused
  with its errors, and the running policy stays. **`clear`** stops enforcing,
  and everything passes.

### Knobs

A policy can read a named value instead of hard-coding it, with a default:

```c
// @knob port  The port to guard.
filter {
  if (dport != knob("port") ?? 80) decide pass;
  ...
}
```

```sh
pfwctl knob ls                                   # the enforcing policy's knobs
pfwctl knob set port 8080                        # on the next packet, no reload
pfwctl knob set 2 port 8080                      # a policy by its number in `pfwctl ls`,
pfwctl knob set rules:http/crawlers.pfc port 8080   # or by name, before applying it
pfwctl knob unset port                           # back to the policy's default
```

```
knobs of rules:http/crawlers.pfc @ a1b2c3d   enforcing
  port  8080  set, default 80  The port to guard.
```

- **A value belongs to the policy it was set for.** Two policies that both
  declare `port` do not share one, and a policy keeps its values from one
  pull to the next.
- **Without POLICY**, a knob command means the enforcing policy.
- **A knob of the enforcing policy changes at once**: flows, bans and
  counters are untouched. One set for another policy waits for its `apply`.
- **`knob("name")` is a 64-bit number**, typed in decimal or `0x` hex.
  **`kstr("name")`** is text of up to 64 bytes that the policy looks for in
  the payload.
- `pfwctl ls` lists each policy's knobs under it, a line apiece with what it
  holds and what it is for, and `pfwctl status` shows the ones that are set.
- **A policy's number in `pfwctl ls` names it** anywhere a POLICY goes:
  `pfwctl apply 2`, `pfwctl knob ls 2`, `pfwctl knob set 2 port 8080`.

A knob is one value: a list of ports is not a knob.

### What a policy says about itself

A policy may open with `@key value` lines in its leading comment block, and
`pfwctl ls` prints them under its row:

```c
// @description Resets connections that carry a JNDI lookup string.
// @patches Apache Log4j 2.0-beta9 to 2.14.1
// @cve CVE-2021-44228, CVE-2021-45046
// @severity critical
// @tags http, rce
```

```
  7 ✔ rules:http/log4shell.pfc  2 rules
      Resets connections that carry a JNDI lookup string.
      CVE-2021-44228  CVE-2021-45046  critical  patches Apache Log4j 2.0-beta9 to 2.14.1  #http  #rce
```

The keys are `description`, `patches`, `cve`, `severity`
(`critical`, `high`, `medium`, `low`), `tags`, and `knob NAME` for what a
knob is for. The block ends at the first
line that is not a comment; other comments and other keys are left alone.

Output is colored on a terminal and plain when piped or under `NO_COLOR`;
`--json` prints the service's reply for scripts.

### Across restarts

An isolate has no storage, so the firewall's state (the interfaces it is
attached to, the policy it enforces and the knobs set per policy) is kept as a JavaScript module on the
host. After `attach`, `detach`, `apply`, `clear` and a `knob` change, `pfwctl` asks the service for that module
and writes it to the service's `--state-file`; the next start imports it and
comes up as it was left. Writing under `/var/lib` goes through `sudo`.

Only a service on this host can be saved for. Changed on another host
(`PFW_URL`), the state holds until that service restarts, and `pfwctl` says so.

## Build & run

On macOS, run these inside the Lima VM (see the repo's `AGENTS.md`).

```sh
make             # dist/: index.js, firewall.js, scrape.js + bin/vm.bpf.o + service.toml
make test        # unit tests, under `yeet test`
make apply       # pfwctl up on dist/: create or update the service, and start it
make remove      # stop and remove the service
make install     # pfwctl into $(PREFIX)/bin, the service into $(PREFIX)/share/pfw
make uninstall
```

`PREFIX` is `/usr/local` by default, and the install goes through `sudo` where
that is not yours to write: `make install PREFIX=~/.local` avoids it.

`dist/` is the whole service, so `yeet service import dist` or the tarball
from `make pkg` needs nothing else from this tree.

`pfw-core` is cloned from `git@github.com:yeet-src/pfw-core.git` at
`PFW_CORE_REF` (default `master`) into `.deps/`, and its `vm.bpf.o` built
there. The repository is private, so the clone needs your GitHub SSH key.
`make update` moves it to the ref's newest commit. To build against a local
checkout or an unpacked release package instead:

```sh
make PFW_CORE=../pfw-core
```

```sh
curl http://127.0.0.1:9477/metrics
```

## Configuration

`service.toml` is the service: the listen address, the routes, and where the
firewall starts out. The interfaces are then `pfwctl attach`'s to change.

| what | where | default |
|---|---|---|
| first interfaces | `units.keeper.args`: `--iface <name\|ifindex>[,...]`, until `pfwctl attach` | `lo` |
| listen address | `units.gateway.web-server` | `http://0.0.0.0:9477` |
| saved state | `units.keeper.args`: `--state-file <path>` | `/var/lib/pfw/state.js` |
| VM object | `units.keeper.args`: `--object <path>` | `bin/vm.bpf.o` beside the bundle |

`pfwctl` has its own settings, kept in `~/.config/pfw/config` (the remotes are
beside it, in `remotes`):

```sh
pfwctl config ls                    # every setting, its value and where it came from
pfwctl config set url ws://10.0.0.5:9477/ctl
pfwctl config get url
pfwctl config unset url             # back to the default
```

| key | environment | what | default |
|---|---|---|---|
| `url` | `PFW_URL` | the service's control route | `ws://127.0.0.1:9477/ctl` |
| `service` | `PFW_SERVICE` | the yeet service `up` and `down` act on | `pfw` |
| `source` | `PFW_SOURCE` | the built service `up` applies | `dist/` or `share/pfw` beside `pfwctl` |
| `cache` | `PFW_CACHE` | where the remotes are cloned | `~/.cache/pfw` |
| `yeet` | `YEET` | the yeet CLI | the first on `PATH` that runs |

An environment variable wins over the file, for one-off runs.

One XDP program fits on an interface, so the service owns the hook of every
interface it is given: nothing else can attach there while it runs.

**`/ctl` is unauthenticated.** Whoever reaches the listen address can replace
the policy, and the default listen address is every interface. Bind
`web-server` to `127.0.0.1` where that reach is too wide.

## The control protocol

One command per connection: a header line, and for `apply` and `check` the
source after it.

```
status
metrics
interfaces
attach <name>[,<name>...]
detach <name>[,<name>...]
apply <bytes> <name>\n<bytes of pfw-C>
clear
check <count> [<first>]\n   then <count> of   <bytes> <name>\n<bytes of pfw-C>
knobs <0|1>
knob-set <0|1> <knob> <value>
knob-unset <0|1> <knob>
saved
```

The knob commands carry the one policy they are about when they name one.

A header may open with `@tty`, `@plain` or `@json`. JSON, the default, is one
line: `{"ok":true,...}` or `{"ok":false,"error"}`. The text formats answer
`ok` or `err` on a line of its own, then the rendered text; the service
renders it, so every client shows the same thing.

Sources are framed by a byte count because `yeet dial` forwards a pipe in
whatever chunks it read.

## Layout

```
service.toml              the service: keeper, scrape and gateway units, and the routes
bin/pfwctl                the CLI: service, interfaces, remotes, policy, settings,
                          over `yeet dial`

src/main.js               the keeper: opens the worker and holds it, serves `ctl`
src/firewall.js           the shared worker: owns the firewall, answers the keeper
                          and the scrapes
src/scrape.js             one scrape: a per-connection isolate on the console portal
src/config.js             yeet.args -> first interfaces, object path, state file
src/worker/protocol.js    what crosses the worker's port
src/worker/link.js        the keeper's end of that port

src/fw/firewall.js        the PfwVm and the policy it enforces
                          (the only kernel-aware module)
src/fw/policy.js          pfw-C source compiled, or refused with its errors
src/fw/meta.js            a policy's `@key` metadata, from its opening comments
src/fw/knobs.js           knob values, kept per policy
src/fw/name.js            a policy's name, and the key that outlives its revision
src/fw/saved.js           interfaces + policy as a module, restored at start
src/fw/interfaces.js      the host's interfaces, names -> ifindexes, from the system graph
src/metrics/document.js   status + stats -> a yeet:telemetry document (pure)

src/ctl/portal.js         the `ctl` portal, in the keeper: one command per peer
src/ctl/request.js        a request's framing: header, then counted sources
src/ctl/stream.js         a portal peer read as a byte stream
src/ctl/reply.js          a request run against the firewall, in the worker
src/ctl/commands.js       status, interfaces, attach, detach, apply, clear, check,
                          knobs, saved
src/ctl/render/           replies as text: palette, status block, metrics page,
                          policy and interface lists
test/                     `yeet test` cases
build/                    toolchain glue, from the yeet project template
```
