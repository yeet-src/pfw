# Configuration

There are three places settings live, and they are about different things.

| what | where | changed with |
|---|---|---|
| how the `pfw` command behaves | `~/.config/pfw/config` | `pfw config` |
| how the firewall service starts | `/usr/local/share/pfw/service.toml` | an editor, then `pfw up` |
| what the firewall is doing | `/var/lib/pfw/state.js` | `pfw attach`, `apply`, `knob`, `shadow` |

## The command's settings

```sh
pfw config ls
```

```
settings  /home/you/.config/pfw/config
  url      ws://127.0.0.1:9477/ctl  default
  service  pfw                      default
  source   /usr/local/share/pfw     default
  cache    /home/you/.cache/pfw     default
  yeet     /usr/local/bin/yeet      default
```

```sh
pfw config get url
pfw config set url ws://10.0.0.5:9477/ctl
pfw config unset url          # back to the default
```

| key | environment | what | default |
|---|---|---|---|
| `url` | `PFW_URL` | where the firewall's control route is | `ws://127.0.0.1:9477/ctl` |
| `service` | `PFW_SERVICE` | the name of the yeet service `up`, `down` and `restart` act on | `pfw` |
| `source` | `PFW_SOURCE` | the service's files that `up` applies | `share/pfw` beside the command |
| `cache` | `PFW_CACHE` | where policy repositories are cloned | `~/.cache/pfw` |
| `yeet` | `YEET` | the yeet command | the first on `PATH` that runs |

An environment variable wins over the file, for a one-off:
`PFW_URL=ws://10.0.0.5:9477/ctl pfw status`. `PFW_CONFIG` names a different
settings file.

Your remotes are kept beside the settings, in `~/.config/pfw/remotes`.

### Options on every command

| option | effect |
|---|---|
| `--json` | print the service's reply as JSON |
| `--color` | color even when the output is not a terminal |
| `--no-color` | never color; `NO_COLOR` does the same |

## The service file

`/usr/local/share/pfw/service.toml` says how the firewall starts. After
editing it, run `pfw up`: it sees the change and restarts the firewall.

| setting | line | default |
|---|---|---|
| the address pfw listens on | `web-server = "http://127.0.0.1:9477"` | this machine only |
| the interface it starts on, the first time | `args = ["--iface", "lo"]` | `lo` |
| where it saves its state | add `"--state-file", "/path/state.js"` to `args` | `/var/lib/pfw/state.js` |

Things to know:

- **`--iface` only matters until you run `pfw attach`.** After that, pfw
  starts on the interfaces it remembers.
- **Changing the listen address changes who can reach pfw.** Read
  [Security](security.md) first. If you change the port, tell the command:
  `pfw config set url ws://127.0.0.1:NEWPORT/ctl`.
- **Reinstalling replaces this file.** Keep a copy of your changes.

## What the firewall remembers

pfw saves, and restores when it starts:

- the interfaces it is attached to,
- the policy in place,
- the knobs you have set, for every policy,
- whether shadow mode is on.

So a restart, an upgrade or a reboot brings it back as you left it.

It is saved after `attach`, `detach`, `apply`, `clear`, `shadow`, `unshadow`
and `knob set`/`unset`, to `/var/lib/pfw/state.js`, with `sudo`. Each of
those commands ends with a line saying so:

```
✔ saved for restarts at /var/lib/pfw/state.js
```

Counters, tracked connections and bans are *not* saved. They start over when
the firewall restarts.

## Driving a firewall on another machine

`pfw` can talk to a firewall running elsewhere:

```sh
pfw config set url ws://10.0.0.5:9477/ctl
pfw status
```

Two limits:

- **The other firewall has to be reachable**, which means its listen address
  was opened up. See [Security](security.md).
- **Changes made this way are not saved there.** They hold until that
  firewall restarts, and `pfw` warns you each time. Saving is done by a `pfw`
  on the same machine as the firewall. `up`, `down` and `restart` also only
  act on this machine.
