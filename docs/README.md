# pfw documentation

New here? Read these three, in order:

1. [Installing](install.md)
2. [Getting started](getting-started.md)
3. [Security](security.md)

Putting it in front of real traffic? Follow
[Deploying, step by step](deploy.md). Rather have a coding agent do it?
[Setting up with an AI agent](agents.md).

## Using pfw

| | |
|---|---|
| [Interfaces](interfaces.md) | choosing what pfw filters |
| [Using policies](policies.md) | repositories, listing, applying, shadow mode, trials, rolling back |
| [Knobs](knobs.md) | changing a policy's values without editing it |
| [Metrics](metrics.md) | the dashboard, the text page, and Prometheus |
| [Configuration](configuration.md) | pfw's settings, the service file, what is remembered |
| [Troubleshooting](troubleshooting.md) | `pfw doctor`, and the errors people meet |
| [Command reference](commands.md) | every command and what it does |

Files to copy for Prometheus and Grafana are in
[`contrib/`](../contrib/README.md).

## Writing policies

| | |
|---|---|
| [Writing a policy](writing-policies.md) | the language by example, metadata, knobs, testing |

## Inside pfw

| | |
|---|---|
| [How it works](architecture.md) | what runs where, and why |
| [Developing](developing.md) | building, testing, the source tree, packaging |
| [Control protocol](protocol.md) | what `pfw` says to the service |

## Words used here

| word | meaning |
|---|---|
| **policy** | one `.pfc` file: the program pfw runs on every packet |
| **rule** | a named verdict inside a policy; pfw counts packets by rule |
| **verdict** | what a policy decides for a packet: `pass`, `drop`, `rst`, `ban` or `count` |
| **remote** | a git repository of policies that pfw pulls from |
| **knob** | a value a policy reads, like a port, that you can set from outside it |
| **shadow mode** | a dry run: verdicts are counted, and every packet passes |
| **trial** | a change that undoes itself at a deadline unless you run `pfw confirm` |
| **interface** | a network connection of the machine, such as `eth0`; `lo` is the machine talking to itself |
| **XDP** | the place in Linux where pfw runs: at the network driver, before the rest of the system |
| **yeet** | the platform pfw runs on; the *service* is pfw's part that stays running |
