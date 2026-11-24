# How it works

pfw is three things: an engine that runs in the Linux kernel, a service that
looks after it, and a command that talks to the service.

<!-- diagram: architecture -->
```mermaid
flowchart TB
    you(["you"]) -->|"pfw command"| ctl
    prom(["Prometheus"]) -->|"scrape"| metrics
    you -->|"pfw metrics"| ui

    subgraph gateway["gateway: the web server, 127.0.0.1:9477"]
        metrics["/metrics"]
        ctl["/ctl"]
        ui["/ui"]
    end

    metrics --> scrape["scrape<br/>one isolate per request"]
    ctl --> keeper["keeper<br/>always running"]
    ui --> app["metrics app<br/>one isolate per viewer"]

    scrape --> firewall
    keeper --> firewall
    app --> firewall

    firewall[["firewall: a shared worker<br/>policy, knobs, counters, saved state"]]
    firewall --> engine["pfw-core engine<br/>at XDP, in the kernel"]
    engine --- nic(["network interface"])

    classDef outside fill:#1f2937,stroke:#9ca3af,color:#f9fafb
    classDef one fill:#3b0764,stroke:#c084fc,color:#faf5ff
    classDef kernel fill:#052e16,stroke:#4ade80,color:#f0fdf4
    class you,prom,nic outside
    class firewall one
    class engine kernel
```
<!-- /diagram -->

## The engine

[pfw-core](https://github.com/yeet-src/pfw-core) is a small virtual machine
for matching packets. It is loaded into the kernel once, at **XDP**: the
earliest point Linux offers, in the network driver, before a packet is given
to the rest of the system.

A policy is compiled to that machine's instructions and written into tables
the loaded program reads. So:

- **Applying a policy loads nothing new into the kernel.** The tables are
  written, then one switch is flipped, and the next packet runs the new
  policy. That is why a swap is instant and drops nothing.
- **A knob is a cell in a table.** Setting one is a single write.
- **Linux checks the engine once**, not every policy. The language is limited
  (no unbounded loops, fixed budgets) so that any policy is safe by
  construction.

### What happens to a packet

<!-- diagram: packet-path -->
```mermaid
flowchart TD
    wire(["a packet arrives on an attached interface"]) --> hook["XDP hook: pfw's engine runs first,<br/>before the rest of the system"]
    hook --> standing{"is the sender banned,<br/>or its connection already decided?"}
    standing -->|"yes"| enforce["the standing verdict applies"]
    standing -->|"no"| policy["the policy runs, top to bottom,<br/>until a decide"]
    policy --> verdict{"verdict"}

    verdict -->|"pass"| through(["on to the system, as if pfw were not there"])
    verdict -->|"count"| counted["counted against its rule"] --> through
    verdict -->|"drop, rst, ban"| shadow{"shadow mode?"}

    shadow -->|"on"| would["counted as would block"] --> through
    shadow -->|"off"| blocked["counted against its rule"]
    blocked --> drop(["drop: discarded silently"])
    blocked --> rst(["rst: connection cut, both ends told"])
    blocked --> ban(["ban: sender blocked for a while"])
    enforce --> drop

    classDef good fill:#052e16,stroke:#4ade80,color:#f0fdf4
    classDef stop fill:#450a0a,stroke:#f87171,color:#fef2f2
    classDef dry fill:#422006,stroke:#facc15,color:#fefce8
    class through good
    class drop,rst,ban stop
    class would,shadow dry
```
<!-- /diagram -->

In shadow mode a blocking verdict is counted and the packet passes all the
same.

An interface has one XDP hook, which is why pfw owns the interfaces it is
attached to.

## The service

pfw runs as a [yeet](https://yeet.cx) service: JavaScript in isolates that
yeet starts, supervises and restarts. It has four parts.

| part | lives | does |
|---|---|---|
| **firewall** | as long as the keeper holds it | owns the engine: the policy, the knobs, the counters, the saved state |
| **keeper** | always | holds the firewall alive; serves `/ctl` and passes each command to it |
| **scrape** | for one request | asks the firewall for its counters and prints them for Prometheus |
| **metrics app** | for one viewer | draws the dashboard from what the firewall sends each second |

The firewall is a *shared worker*: one copy, which every other part reaches.
That matters because there can be only one holder of the XDP hook. The parts
that serve people come and go, one for each request or viewer, and none of
them can disturb the engine.

### What happens on `pfw apply 2`

<!-- diagram: apply -->
```mermaid
sequenceDiagram
    actor you
    participant pfw as pfw command
    participant keeper
    participant firewall as firewall worker
    participant engine as engine in the kernel
    participant disk as /var/lib/pfw/state.js

    you->>pfw: pfw apply rules:http/crawlers.pfc
    pfw->>pfw: read the file from its clone of the repository
    pfw->>keeper: apply, and the policy's source (yeet dial /ctl)
    keeper->>firewall: the whole request
    firewall->>firewall: compile

    alt it does not compile
        firewall-->>pfw: refused, with the line
        pfw-->>you: the error. The running policy is untouched
    else it compiles
        firewall->>engine: write the tables, then flip one switch
        Note over engine: the next packet runs the new policy
        firewall-->>keeper: status, already formatted
        keeper-->>pfw: status
        pfw-->>you: applied, and the status block
        pfw->>keeper: saved
        keeper-->>pfw: the firewall's state, as a module
        pfw->>disk: write it
    end
```
<!-- /diagram -->

1. `pfw` reads the policy file from its clone of the repository.
2. It connects to `/ctl` with `yeet dial` and sends the command and the file.
3. The keeper reads the whole request and hands it to the firewall.
4. The firewall compiles the policy. A mistake is sent back, and nothing else
   happens.
5. It writes the compiled policy into the engine's tables and flips the
   switch.
6. It sends back the status, already formatted for your terminal.
7. `pfw` asks the firewall for its state and writes that to disk.

### Why the service formats the output

`pfw status`, `ls`, `attach`, `knob ls` and the text of `metrics` are
rendered by the firewall and printed by `pfw` as they arrive. Every client
shows the same thing, and the logic is where it can be tested. The command
renders only what is about itself: `help`, `config`, `remote ls`, `doctor`.

A consequence: after an upgrade, output looks old until `pfw up` has moved
the firewall onto the new version. `pfw doctor` checks for that.

### Why the command saves the state

A yeet isolate has no disk. So the firewall cannot write down what it should
remember. Instead it hands its state to `pfw` as a small JavaScript module,
`pfw` writes it to `/var/lib/pfw/state.js`, and the firewall imports that
file when it next starts.

<!-- diagram: saved-state -->
```mermaid
sequenceDiagram
    participant pfw as pfw command
    participant firewall as firewall worker
    participant disk as /var/lib/pfw/state.js

    Note over firewall: an isolate has no disk of its own

    rect rgb(30, 41, 59)
        Note over pfw,disk: after attach, detach, apply, clear, shadow, knob
        pfw->>firewall: saved
        firewall-->>pfw: interfaces, policy, knobs, shadow mode, as a JavaScript module
        pfw->>disk: write the module
    end

    rect rgb(20, 40, 30)
        Note over pfw,disk: on restart, upgrade or reboot
        firewall->>disk: import the module
        disk-->>firewall: the state as it was left
        firewall->>firewall: attach the interfaces, enforce the policy, set the knobs
    end
```
<!-- /diagram -->

That is why saving works only from the machine the firewall runs on.

### Where a trial's timer runs

`pfw unshadow --confirm 10m` returns at once. The countdown is a timer in
the firewall worker, which holds what the firewall was doing before the
change. At the deadline it puts that back; `pfw confirm` cancels it. Nothing
on your side has to stay open, which is the point: the person who might be
locked out is the one who started it.

While a trial is pending, the state the firewall hands `pfw` to save is the
one before the trial, so a restart cannot make an unconfirmed change
permanent.

### Where the speeds come from

The engine only counts. Once a second the firewall reads its counters and
keeps the last minute of readings; a speed is the difference between two of
them. The dashboard's graphs are that minute.

## The command

`pfw` is a shell script. It does three things itself:

- **git**: cloning and fetching the repositories you named;
- **talking to the service**, one command per connection, through
  `yeet dial`;
- **writing to disk**: its own settings, and the firewall's saved state.

Everything else it asks the service for.

## Ports and paths

| what | where |
|---|---|
| the service's address | `127.0.0.1:9477` |
| `/metrics` | Prometheus text, one short-lived isolate a request |
| `/ctl` | the control route, a WebSocket |
| `/ui` | the dashboard, a terminal over a WebSocket |
| the command | `/usr/local/bin/pfw` |
| the service's files | `/usr/local/share/pfw` |
| saved state | `/var/lib/pfw/state.js` |
| settings and remotes | `~/.config/pfw` |
| cloned repositories | `~/.cache/pfw` |

The diagrams on these pages are kept in [`assets/`](../assets), one file
each.

More detail: [Developing](developing.md) for the source,
[Control protocol](protocol.md) for what crosses `/ctl`.
