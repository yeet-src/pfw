# Writing a policy

A policy is one text file ending in `.pfc`, written in a small language
called pfw-C. This page teaches it by example. The policies in
[pfw-rules](https://github.com/yeet-src/pfw-rules) are more to read and copy
from.

## A whole policy

```c
// @description Resets AI crawlers on a web port by user-agent.
// @tags http, crawlers
// @knob port  The port to guard.

nocase;
pattern gptbot = "GPTBot", claudebot = "ClaudeBot", bytespider = "Bytespider";

filter {
  if (dport != knob("port") ?? 80) decide pass;
  if (scan(payload, 1460) & (gptbot | claudebot | bytespider)) decide rst("crawler", 60);
  decide pass;
}
```

From the top:

- **The `// @` lines describe the policy.** See [Describing it](#describing-it).
- **`nocase;`** makes text matching ignore upper and lower case.
- **`pattern`** names pieces of text to look for.
- **`filter { ... }`** is the program. It runs for every packet, top to
  bottom, until a `decide`.
  - `dport` is the port the packet is going to.
  - `knob("port") ?? 80` reads the knob named `port`, or 80 when nobody has
    set it. The first line says: not the web port? Let it through.
  - `scan(payload, 1460)` searches the first 1460 bytes of the packet's
    contents for all the patterns at once. `& (a | b | c)` asks whether any
    of those was found.
  - `decide rst(...)` cuts the connection. `decide pass` lets the packet go.

## Verdicts

Every path through `filter` must end in a `decide`.

| verdict | what happens |
|---|---|
| `pass` | the packet goes through |
| `drop` | the packet is silently discarded |
| `rst` | the connection is cut, and both ends are told |
| `ban` | the sender is blocked entirely for a while |
| `count` | nothing happens to the packet; it is only counted |

A verdict with a name, like `rst("crawler", 60)` or `drop("too_big")`, is a
**rule**. `pfw status` and `pfw metrics` count packets by rule, so name
anything you will want to see.

**A policy is a whole program.** pfw runs one at a time, so whatever yours
does not decide, it must `pass`. End `filter` with `decide pass;`.

## Describing it

`@key value` comments at the very top are what `pfw ls` prints under the
policy:

```c
// @description Resets connections that carry a JNDI lookup string.
// @patches Apache Log4j 2.0-beta9 to 2.14.1
// @cve CVE-2021-44228, CVE-2021-45046
// @severity critical
// @tags http, rce
// @knob port  The port to guard.
```

| key | what it says |
|---|---|
| `description` | one line: what it blocks and what it leaves alone |
| `patches` | the software and versions it shields |
| `cve` | the CVEs it addresses, comma-separated |
| `severity` | `critical`, `high`, `medium` or `low` |
| `tags` | words to find it by, comma-separated |
| `knob NAME` | what one of its knobs is for |

Only `description` is expected of every policy. The block ends at the first
line that is not a comment. Ordinary comments, and keys pfw does not know,
are left alone.

## Knobs

Anything a user might want to change, read from a knob with a default:

```c
// @knob port     The port to guard.
// @knob enforce  1 to block, 0 to only count.

filter {
  if (dport != knob("port") ?? 80) decide pass;
  if (knob("enforce") ?? 1 == 0) decide count("observed");
  ...
}
```

- `knob("name") ?? default` is a number: a port, a limit, a switch.
- `kstr("name")` is true when a piece of text the user has set appears in the
  packet: `if (kstr("bad_host")) decide drop("blocked_host");`
- Give every knob a default, and a `@knob` line saying what it is for.

Users set them with [`pfw knob set`](knobs.md).

## Testing one

```sh
pfw apply -f ./mine.pfc
```

A file with a mistake is refused, with the line, and the policy that was
running is not touched:

```
✘ Policy ./mine.pfc does not compile: line 7: `nope` is not a verdict (pass, drop, count, ban, rst)
```

Once it applies, see what it does before it does it:

```sh
pfw shadow
pfw apply -f ./mine.pfc
pfw status        # "would block N", and which rules
pfw unshadow
```

In a repository, `pfw ls` compiles every policy and marks the ones that fail,
which is a quick check before you push.

## Sharing them

Put your `.pfc` files in a git repository, in whatever folders you like, and
anyone can use it:

```sh
pfw remote add mine https://github.com/you/your-rules.git
pfw pull
pfw ls
```

## What the language can do

The example uses a small part of it. A policy can also:

- match many patterns in one pass, including a limited kind of regular
  expression;
- walk a packet's fields without copying them: find a delimiter, read a
  number, step through length-prefixed records;
- follow a TCP connection across packets, so text split between two packets
  is still found;
- decode HTTP/2 headers before matching;
- remember things per connection and per sender: a state, a counter, a rate;
- limit rates;
- match the sender against lists of addresses;
- rewrite bytes in place, and redirect packets.

And what it cannot: it has no loops that run an unknown number of times, and
every program has fixed budgets (64 patterns, 64 rules, and so on). That is
what lets Linux prove a policy is safe to run on every packet.

The full language is documented with
[pfw-core](https://github.com/yeet-src/pfw-core), the engine pfw is built on.
