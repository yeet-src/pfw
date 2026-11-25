# pfw

[![ci](https://github.com/yeet-src/pfw/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/yeet-src/pfw/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/yeet-src/pfw)](https://github.com/yeet-src/pfw/releases/latest)
[![last commit](https://img.shields.io/github/last-commit/yeet-src/pfw)](https://github.com/yeet-src/pfw/commits/master)
[![commit activity](https://img.shields.io/github/commit-activity/m/yeet-src/pfw)](https://github.com/yeet-src/pfw/pulse)
[![Discord](https://img.shields.io/badge/Discord-join%20the%20chat-5865F2?logo=discord&logoColor=white)](https://discord.gg/bBRF9d2Gw2)

![The pfw dashboard: traffic passed and blocked, the busiest rules, and how long each decision took](assets/pfw-tui.gif)

A firewall for Linux that reads what is *inside* network traffic, not just
where it comes from, and stops what you tell it to.

You give it a **policy**: a short file of rules such as "reset any web request
whose user-agent is an AI crawler". pfw runs that policy on every packet as it
arrives at the network card, before the rest of the system sees it, and shows
you what it let through and what it stopped.

- **Policies come from git.** Point pfw at a repository of them, pull, pick
  one, apply it. A [public set](https://github.com/yeet-src/pfw-rules) is
  there to begin with.
- **You can try a policy before trusting it.** In *shadow mode* it decides
  and counts as usual and blocks nothing, so you see what it would have done.
- **A change can undo itself.** Enforce a policy *on trial* and it goes back
  after ten minutes unless you confirm it, so a rule that locks you out does
  not keep you out.
- **Changes are live.** Applying a policy, or changing a value it reads, takes
  effect on the next packet, and nothing restarts. Connections already open
  are followed from where the policy picks them up; only a policy that
  decodes a stream (HTTP/2, say) resets the ones open on its port, once.
- **Several policies run at once.** One by default, others for a port, an
  address or an interface of their own, and a chain that every packet runs
  first.
- **It tells you what it is doing**: a dashboard in your terminal, and
  metrics for Prometheus.

## Install

You need a Linux machine, with kernel 6.1 or newer.

```sh
curl -fsSL https://raw.githubusercontent.com/yeet-src/pfw/master/install.sh | sh
```

That checks your machine, installs [yeet](https://yeet.cx) (which pfw runs
on) if you do not have it, asks you to log in, installs the `pfw` command
and starts the firewall, **blocking nothing** until you give it a policy.
More in [Installing](docs/install.md).

## Quick start

```sh
pfw setup                    # asks which interface and which policy; blocks nothing
pfw status                   # "would block N" is what it would have stopped
pfw enforce --confirm 10m   # make it real, on trial for ten minutes
pfw confirm                  # keep it, once your site and your login still work
pfw metrics                  # the dashboard
```

`pfw setup` leaves the policy *rehearsing*: deciding and counting, blocking
nothing. If you do not run `pfw confirm`, the trial ends by itself and the
policy goes back to rehearsing.

[Getting started](docs/getting-started.md) walks through each of those with
what you should see. For a machine with real traffic on it, follow
[Deploying, step by step](docs/deploy.md). Or let a coding agent do it:
[Setting up with an AI agent](docs/agents.md).

## How it works

<!-- diagram: how-it-works -->
```mermaid
%%{init: {"flowchart": {"wrappingWidth": 300}}}%%
flowchart TB
    subgraph author["you, or an agent"]
        direction LR
        write["<b>1</b> write a policy (.pfc)<br/>and cases: what it stops,<br/>what it lets through"]
        pr["<b>2</b> open a pull request<br/>CI runs the cases,<br/>then you merge"]
        write --> pr
    end

    remote("<b>git remote</b><br/>pfw-rules, or your own<br/>policies, commits, tags")

    subgraph host["your Linux host"]
        pfw["<b>pfw: the command</b><br/><b>and its yeet service</b><br/><b>3</b> pfw pull: fetch,<br/>nothing running changes<br/><b>4</b> pfw shadow, pfw apply:<br/>compiled on the host,<br/>a mistake changes nothing"]
        kernel["<b>kernel, 6.1 or newer</b><br/><b>5</b> pfw-core engine at XDP<br/>checked by Linux once<br/>a policy is new tables<br/>and one switch flipped<br/>each packet: pass, reset<br/>or drop, and counted"]
        state["<b>saved state</b><br/><b>6</b> /var/lib/pfw/state.js<br/>restored after a reboot"]
        pfw -->|"write tables"| kernel
        pfw -->|"save"| state
    end

    trial["<b>7</b> you, or an agent:<br/>pfw enforce --confirm 10m<br/>then pfw confirm,<br/>undone unless confirmed"]

    author -->|"push"| remote
    remote -->|"pull"| host
    kernel -->|"would block N, per rule<br/>pfw status, pfw metrics"| trial

    classDef step fill:#f6f5f1,stroke:#8c8c86,color:#1a1a1a
    classDef yeet fill:#ffe500,stroke:#0d0d0d,color:#0d0d0d
    class write,pr,remote,kernel,state,trial step
    class pfw yeet
    style author fill:none,stroke:#8c8c86
    style host fill:none,stroke:#8c8c86,stroke-dasharray:6 5
```
<!-- /diagram -->

The `pfw` command talks to a service that owns the firewall; the firewall
runs your policy in the kernel, on the interfaces you attached it to. More in
[How it works](docs/architecture.md).

## Documentation

| | |
|---|---|
| [Installing](docs/install.md) | what you need, the installer, upgrading, uninstalling |
| [Getting started](docs/getting-started.md) | from a fresh install to an enforcing policy |
| [Deploying, step by step](docs/deploy.md) | a checklist for real traffic: every step with what to check and how to back out |
| [Setting up with an AI agent](docs/agents.md) | prompts to paste into a coding agent to install, deploy, write a policy, or diagnose |
| [Interfaces](docs/interfaces.md) | choosing what pfw filters |
| [Using policies](docs/policies.md) | repositories, listing, applying, shadow mode |
| [Knobs](docs/knobs.md) | changing a policy's values without editing it |
| [Writing a policy](docs/writing-policies.md) | the language, by example |
| [Existing rules](https://github.com/yeet-src/pfw-rules) | virtual patches ready to go (PHP2Shell, LiteLLM, Java4Shell, etc) |
| [Metrics](docs/metrics.md) | the dashboard, and Prometheus |
| [Configuration](docs/configuration.md) | pfw's settings, the service file, what is remembered |
| [Security](docs/security.md) | who can reach pfw, and what they can do |
| [Troubleshooting](docs/troubleshooting.md) | `pfw doctor`, and the errors people meet |
| [Command reference](docs/commands.md) | every command |
| [How it works](docs/architecture.md) | what runs where |
| [Developing](docs/developing.md) | building, testing, the source |
| [Control protocol](docs/protocol.md) | what `pfw` says to the service |

## Two things to know first

- **pfw sees traffic as it is on the wire.** The contents of an HTTPS
  connection are encrypted, so a rule that looks for text inside a request
  only matches plain HTTP, or traffic behind whatever ends the encryption.
  Rules about ports and addresses are not affected.
- **pfw's own port has no password.** It listens on this machine only, by
  default, and anyone who can reach it can change your policy. Read
  [Security](docs/security.md) before opening it to a network.
