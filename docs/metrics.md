# Metrics

pfw counts everything it does. There are three ways to look.

## The dashboard

```sh
pfw metrics
```

A terminal application, redrawn every second. Run on a terminal it opens;
piped or redirected, `pfw metrics` prints [the text page](#the-text-page)
instead.

The bar across the top is always there: whether pfw is up, the interfaces,
the policy in place, `SHADOW` when the dry run is on, and totals.

### Getting around

| key or action | does |
|---|---|
| `1` `2` `3` `4` | go to a page |
| Tab, `←` `→`, `h` `l` | next and previous page |
| click a tab | go to that page |
| `↑` `↓`, `j` `k`, mouse wheel | move the cursor, or scroll |
| PgUp, PgDn, Space | a screenful |
| `g`, `G` | the top, the bottom |
| click a rule | pick it |
| `q`, Esc | leave |

### 1 overview

Traffic, with a little of everything under it.

- **traffic**: packets a second over the last minute, tallest at the peak.
  Beside it the verdicts as meters, then totals.
- **speed**: how fast packets, passes, blocks, scanned bytes and new
  connections are moving right now, each with its last minute drawn.
- **decision time**: how long pfw takes to decide a packet. `p50`, `p90` and
  `p99` are the time under which half, nine in ten, and ninety-nine in a
  hundred decisions fall.
- **busiest rules**: the rules of the policy by how many packets ended on
  each. Click one to open it on the rules page.
- **engine**: the raw counters.

### 2 rules

What is being stopped, and by which rule.

- **blocked**: blocks a second over the last minute.
- **rules**: every rule, with hits, share of all hits, the mean time a
  decision ending there took, and hits a second. The cursor picks one.
- The box beside it is the picked rule in numbers.
- **clean passes**: how long the packets no rule stopped took to decide. That
  is the cost pfw adds to ordinary traffic.

### 3 timing

What deciding costs.

- **decision time**: the whole histogram, a row a bucket.
- **in numbers**: decisions timed, the mean, the percentiles, total time
  spent deciding, bytes scanned.
- **slowest**: rules, and clean passes, by mean decision time.
- **payload scanned**: bytes a second pfw is reading.

### 4 engine

The engine's own counters, grouped.

| group | what it counts |
|---|---|
| packets | seen, run through the policy, and each verdict; `faults` is a policy run that failed |
| standing | packets decided by a verdict already made for their connection or their sender |
| inspection | bytes scanned, connections tracked, time spent deciding |
| events | messages from the policy to pfw; `ring full` counts ones lost |
| reassembly | TCP segments that did not simply follow on; `over` and `trunc` are data pfw could not fully inspect |
| http/2 | HTTP/2 header blocks; `failed`, `trunc` and `unresolved` are headers it could not fully read |

Counters that have moved stand out; the ones in red are worth a look.

## The text page

```sh
pfw metrics | cat
pfw --json metrics
```

The same numbers as plain text, or as JSON for a script. Also what you get
with `--no-color`.

## Status, for a quick look

```sh
pfw status
```

```
● pfw  up 3d 4h   on eth0
  policy   rules:http/crawlers.pfc @ b58a001   enforcing   applied 2h ago
  knobs    port 8080
  packets  1.23M seen   pass 1.19M   drop 312   rst 4.1k   ban 17
  rules    crawler 1.4k
```

It exits with a non-zero status when pfw is down or does not answer, so it
doubles as a health check in a script.

### What the numbers count

They are **packets, not requests**. One blocked request is usually several
packets: the one that was caught, and the retries the client sends before
it gives up. So `rst 12` can be three requests, and in shadow mode `would
block 10` can be two.

The `rules` line is the nearest thing to a count of requests: a rule is
counted **once, when it decides**, however many packets its verdict then
stops. The packets that followed are counted apart, as
`pfw_rule_standing_packets_total`.

`ban` is the senders banned. It is not a fourth kind of packet, and is not
added to `blocked`: the packet that earned a ban is one of the drops, and
blocked is `drop` plus `rst`.

With [several policies in place](policies.md#several-policies-at-once),
each is a line of its own, and a rule says whose it is: `crawler (tcp/8443)`.

## Prometheus

pfw publishes its metrics at:

```
http://127.0.0.1:9477/metrics
```

```yaml
scrape_configs:
  - job_name: pfw
    static_configs:
      - targets: ["127.0.0.1:9477"]
```

That address is this machine only. To scrape from elsewhere, read
[Security](security.md) first.

### What is exported

State:

| metric | meaning |
|---|---|
| `yeet_worker_up` | 1 when the firewall answered the scrape |
| `pfw_up` | 1 while attached to an interface |
| `pfw_interface_info{interface,ifindex}` | the interfaces it is attached to |
| `pfw_shadow` | 1 while in shadow mode |
| `pfw_trial_pending` | 1 while a change made with `--confirm` waits to be confirmed |
| `pfw_policy_enforcing` | 1 while a policy is in place |
| `pfw_policy_info{route,name,rev,severity,cve}` | the policies in place, one series each |
| `pfw_policy_applied_timestamp_seconds{route}` | when each was applied |
| `pfw_knob{policy,knob}` | their numeric knobs, as set |

`route` is where a policy is: `default`; `first`, then `first.1` and so on
down the chain run first; or the packets a route is for, as `pfw status`
names it (`tcp/8443`, `10.1.0.0/16 tcp/22 on eth0`).

Traffic:

| metric | meaning |
|---|---|
| `pfw_packets_seen_total` | packets that reached pfw |
| `pfw_packets_total{verdict}` | packets by verdict: `pass`, `drop`, `rst`. Each packet is in one; a `ban` drops, and is counted as a drop |
| `pfw_bans_total` | `ban` verdicts decided. The packet of each is a drop, and is counted as one |
| `pfw_program_runs_total` | packets a policy ran on |
| `pfw_shadowed_total` | blocking verdicts shadow mode let through |
| `pfw_shadow_standing_packets_total` | packets a verdict already standing would have stopped, passed in shadow mode |
| `pfw_standing_verdict_packets_total{scope}` | packets decided by a verdict already standing, on their `flow` or `source` |
| `pfw_flows_created_total` | connections pfw started tracking |
| `pfw_scanned_bytes_total` | payload bytes read |
| `pfw_nat_reversed_total` | reply packets translated back after a redirect |

Rules and timing:

| metric | meaning |
|---|---|
| `pfw_rule_hits_total{route,rule}` | times each rule decided, since its policy was applied |
| `pfw_rule_standing_packets_total{route,rule}` | packets stopped by a verdict the rule left standing: a dropped connection's retries, what a banned sender goes on to send |
| `pfw_rule_runs_total{route,rule}` | decisions timed, by the rule they ended on |
| `pfw_rule_decide_nanoseconds_total{route,rule}` | time spent deciding, by rule |
| `pfw_decide_duration_nanoseconds` | histogram of how long a decision took |

The rule named `-` stands for packets that ended on no rule. Two policies
may name a rule alike, so sum `by (rule)` only when that is what you mean.

Health:

| metric | meaning |
|---|---|
| `pfw_faults_total` | policy runs that failed |
| `pfw_events_logged_total` | events sent from the policy |
| `pfw_events_dropped_total` | events lost on the way |
| `pfw_frames_sampled_total` | packets copied out as samples |
| `pfw_reassembly_total{event}` | TCP segments that did not simply follow on; `oversize` and `truncated` are data not fully inspected |
| `pfw_h2_total{event}` | HTTP/2 header blocks; `unresolved`, `truncated` and `failed` are headers not fully read |

### Worth alerting on

These, as rules ready to load, are in
[`contrib/prometheus/alerts.yml`](../contrib/prometheus/alerts.yml), with a
Grafana dashboard beside them in
[`contrib/grafana/pfw.json`](../contrib/grafana/pfw.json). See
[`contrib/`](../contrib/README.md).

- `pfw_up == 0` or `yeet_worker_up == 0`: pfw is not filtering.
- `pfw_policy_enforcing == 0`: no policy is in place.
- `pfw_shadow == 1` for longer than you meant.
- `rate(pfw_faults_total[5m]) > 0`.
- `rate(pfw_events_dropped_total[5m]) > 0`.
- A rise in `pfw_reassembly_total{event=~"oversize|truncated"}`: traffic pfw
  cannot fully see. See
  [What pfw cannot see](security.md#what-pfw-does-not-see).

Rates are for Prometheus to work out: `rate(pfw_packets_total[1m])`.
