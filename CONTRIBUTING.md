# Contributing to pfw

Thank you for looking. This page is the short version;
[Developing](docs/developing.md) has the detail.

## Reporting a problem

Open an [issue](https://github.com/yeet-src/pfw/issues/new/choose) and paste
the output of:

```sh
pfw --version
pfw doctor
pfw status
```

`pfw doctor` checks everything pfw depends on, so its output answers most of
the questions we would otherwise ask. If traffic is being blocked that should
not be, run `pfw rollback` or `pfw clear` first and report after.

A policy that blocks the wrong thing, or misses what it should catch, belongs
in [pfw-rules](https://github.com/yeet-src/pfw-rules/issues). A problem in the
policy language or the engine belongs in
[pfw-core](https://github.com/yeet-src/pfw-core/issues). If you are not sure,
open it here.

**A security problem** should not go in a public issue: use
[Report a vulnerability](https://github.com/yeet-src/pfw/security/advisories/new).

## Changing pfw

It builds and runs on Linux. On macOS, work inside a Linux VM.

```sh
git clone https://github.com/yeet-src/pfw.git
cd pfw
make            # build into dist/
make test       # unit tests, the command's tests, and the checks on docs and contrib
make scratch    # the end-to-end test, against a scratch firewall made for it
```

`make scratch` starts a second firewall on a port and an interface of its
own and removes it after, so it is safe on a machine that has a real one.
`sh test/scratch.sh` with no arguments gives you a shell to try things in.

Before you open a pull request:

- `make test` passes, and `make scratch` if you touched the command or the
  service;
- a change in behavior has a test: a unit test in `test/*.test.js` for the
  service, a case in `test/cli.sh` for the command, a step in `test/e2e.sh`
  for what needs real traffic;
- a new or changed command is in `pfw help`, in
  [the command reference](docs/commands.md), and in what
  `pfw __complete` offers;
- a diagram is edited in `assets/` and copied into the pages with
  `assets/embed.sh`.

### How the code is laid out

- `bin/pfw` is the command: POSIX `sh`, no bashisms. It does git, talks to
  the service, and writes to disk.
- `src/` is the service: JavaScript in yeet isolates. `src/fw/` is the
  firewall, `src/ctl/` the control commands and what they print,
  `src/ui/` the dashboard, `src/metrics/` the Prometheus page.
- What a command prints is rendered by the service
  (`src/ctl/render/`), so it can be unit-tested and every client shows the
  same thing.

The source tree is listed file by file in
[Developing](docs/developing.md#the-source).

### Commits and versions

Every push to `master` that passes CI is released. The version comes from
the commit subjects since the last release: put `[bump:patch]`,
`[bump:minor]` or `[bump:major]` in the subject. An unmarked commit is a
minor bump.

Write the subject as what changed for someone using pfw:

```
pfw rollback: back to the policy before this one [bump:minor]
docs: the deploy guide enforces on trial [bump:patch]
```
