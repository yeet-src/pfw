# Developing

Building pfw, testing it, and where things are. [How it works](architecture.md)
is the picture this fills in.

## Building

On Linux. On macOS, inside the Lima VM (see the repository's `AGENTS.md`).

```sh
make             # dist/: the four bundles, bin/vm.bpf.o and service.toml
make test        # unit tests, under `yeet test`
make apply       # pfw up on dist/: create or update the service, and start it
make remove      # stop and remove the service
make install     # pfw into $(PREFIX)/bin, the service into $(PREFIX)/share/pfw
make uninstall
make pkg         # pkg/pfw.tar.gz: what install.sh installs
make update      # move the pfw-core clone to its ref's newest commit
make clean       # remove build output (keeps the pfw-core clone)
make distclean   # and the clone
make V=1         # show the commands
```

`PREFIX` is `/usr/local` by default, and the install goes through `sudo`
where that is not yours to write: `make install PREFIX=~/.local` avoids it.

The build needs `make` and the `yeet` command, which supplies the toolchain
(esbuild, and clang for the engine). It picks the first `yeet` on `PATH` that
actually runs.

### pfw-core

The engine is [pfw-core](https://github.com/yeet-src/pfw-core). The build
clones it from `https://github.com/yeet-src/pfw-core.git` at `PFW_CORE_REF`
(default `master`) into `.deps/`, builds its `vm.bpf.o` there, and links it
into `node_modules` so both esbuild and the yeet runtime resolve `pfw-core`
as an installed package.

To build against a local checkout or an unpacked release instead:

```sh
make PFW_CORE=../pfw-core
```

Switching between the two forces a rebuild, so `dist/` never mixes them.

### What is built

`dist/` is the whole service:

| file | what it is |
|---|---|
| `index.js` | the keeper |
| `firewall.js` | the firewall shared worker, with pfw-core's compiler inside it |
| `scrape.js` | the Prometheus scrape isolate |
| `ui.js` | the metrics app |
| `bin/vm.bpf.o` | the engine, from pfw-core |
| `service.toml` | the service file |

`yeet service import dist` needs nothing else from the tree.

## Running a change

```sh
make apply
```

That is `PFW_SOURCE=dist bin/pfw up`. It applies `dist/` as the `pfw`
service. A changed bundle stops the running firewall first: yeet would
otherwise start the new isolate beside the old one, and the old one holds the
XDP hook.

`service.toml` starts on `lo`. To try a change without touching `lo`, copy
`dist/` somewhere, point its `--iface` at a scratch interface (a veth pair
does well) and its `web-server` at another port, and run `pfw` with
`PFW_SOURCE`, `PFW_SERVICE`, `PFW_URL` and `PFW_CONFIG` set to match.

## Testing

```sh
make test
```

The tests in `test/` run under `yeet test`. They cover what is pure: the
metrics document, the text renderers, policy metadata, knobs, speeds and
percentiles, and the argument parsing. What touches the kernel is exercised
by hand against a scratch service.

The dashboard can be looked at without a screen by running it in tmux and
capturing the pane:

```sh
tmux new-session -d -s shot -x 120 -y 36 "yeet dial ws://127.0.0.1:9477/ui"
sleep 3; tmux capture-pane -t shot -p; tmux kill-session -t shot
```

## The source

```
install.sh                yeet, a login, the command and the service, in one run
service.toml              the service: keeper, scrape, ui and gateway units, and the routes
bin/pfw                   the command

src/main.js               the keeper: opens the worker and holds it, serves `ctl`
src/firewall.js           the shared worker: owns the firewall, answers everyone else
src/scrape.js             one scrape: a per-connection isolate on the console portal
src/config.js             yeet.args -> first interfaces, object path, state file
src/worker/protocol.js    what crosses the worker's port
src/worker/link.js        the keeper's end of that port

src/fw/firewall.js        the PfwVm and the policy it enforces (the only kernel-aware module)
src/fw/policy.js          pfw-C source compiled, or refused with its errors
src/fw/meta.js            a policy's `@key` metadata, from its opening comments
src/fw/knobs.js           knob values, kept per policy
src/fw/rates.js           the counters sampled each second: speeds and percentiles
src/fw/name.js            a policy's name, and the key that outlives its revision
src/fw/saved.js           the state as a module, restored at start
src/fw/interfaces.js      the host's interfaces, from yeet's system graph
src/metrics/document.js   status + stats -> a yeet:telemetry document (pure)

src/ctl/portal.js         the `ctl` portal, in the keeper: one command per peer
src/ctl/request.js        a request's framing: header, then counted sources
src/ctl/stream.js         a portal peer read as a byte stream
src/ctl/reply.js          a request run against the firewall, in the worker
src/ctl/commands.js       the commands
src/ctl/render/           replies as text: palette, status, metrics, lists, bars

src/ui/main.jsx           the metrics app: status bar, tabs, keys and mouse
src/ui/pages.jsx          its four pages: where each box goes, what a click means
src/ui/views.js           what the boxes say, as rows of colored runs (pure)
src/ui/panel.jsx          a box with its title in the border, and the scrolling list
src/ui/line.jsx           a row drawn, and rows aligned into columns
src/ui/feed.js            its line to the worker, asked once a second

test/                     `yeet test` cases
build/                    toolchain glue, from the yeet project template
```

## Things that are easy to get wrong

- **A message port nothing refers to is garbage-collected**, and messages to
  it then vanish. The firewall keeps every open port in a set for that
  reason.
- **A yeet isolate has no filesystem, no fetch and no exec.** That is why
  git lives in `bin/pfw`, and why state is saved by the command.
- **`yeet dial` forwards a pipe in arbitrary chunks**, so the control
  protocol frames policy source by byte count.
- **The service closes a control connection as soon as it has answered**,
  which can beat `yeet dial` to its end-of-input and make it exit non-zero.
  `pfw` counts any reply as a reply.
- **yeet spells a flag's hyphens as underscores**: `--state-file` arrives as
  `state_file`.
- **Leading and trailing spaces in a text run are trimmed** by the terminal
  toolkit. The dashboard uses non-breaking spaces where a space must stay.
- **The palette is in two places**: `src/ctl/render/palette.js` for what the
  service renders, and the top of `bin/pfw` for what the command renders.

## Packaging and releasing

```sh
make pkg
```

makes `pkg/pfw.tar.gz`: `bin/pfw` and `share/pfw/`, laid out as a prefix
holds them, so installing is unpacking. Its bundles are minified.

One package serves every architecture. The bundles are JavaScript, the
command is a shell script, and the engine (`vm.bpf.o`) is BPF bytecode, which
the kernel loads the same on any of them.

Run outside a checkout, `install.sh` downloads `pfw.tar.gz` from the latest
GitHub release. To cut one:

```sh
make pkg
gh release create v0.1.0 pkg/pfw.tar.gz --title "pfw 0.1.0"
```
