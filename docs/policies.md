# Using policies

A **policy** is one file ending in `.pfc`: the program pfw runs on every
packet. pfw runs **one policy at a time**. Policies live in git repositories,
which pfw calls **remotes**.

## Remotes

```sh
pfw remote ls
```

```
  rules  https://github.com/yeet-src/pfw-rules.git  default branch at b58a001
```

`rules`, the public [pfw-rules](https://github.com/yeet-src/pfw-rules)
repository, is there from the start. Add your own beside it:

```sh
pfw remote add acme https://github.com/acme/policy.git
pfw remote add acme git@github.com:acme/policy.git -r v1.4.0    # a branch, tag or commit
pfw remote rm acme
```

- The name (`acme`) is yours to choose: letters, digits, dot, dash,
  underscore.
- The URL is anything `git clone` takes. A private repository works if your
  git can already reach it.
- `-r` pins a branch, tag or commit. Without it, pfw follows the repository's
  default branch.
- Removing `rules` removes it for good; it does not come back.

## Pulling

```sh
pfw pull          # every remote
pfw pull acme     # one
```

```
✔ rules  fc5a1f0 → b58a001
  ~ http/crawlers.pfc
```

`pull` downloads what is new and says what changed: `+` added, `~` changed,
`-` removed. **Pulling changes nothing about what is running.** A newer
version of your policy is not in effect until you apply it.

## Listing

```sh
pfw ls
```

```
apps
   1 ✔ rules:apps/confluence-remote-api.pfc   3 rules
       Resets every request for Confluence's Remote API, SOAP and XML-RPC.
       CVE-2026-90436  critical  patches Atlassian Confluence Data Center 1.x to 9.x  #http  #java  #rce
   2 ✔ rules:apps/litellm-guardrails.pfc      2 rules
       …

http
   6 ✔ rules:http/crawlers.pfc                2 rules
       Resets AI crawlers on a web port by user-agent.
       #http  #crawlers
       knob  port  80  The port to guard.

runtimes
▸  8 ✔ rules:runtimes/log4shell.pfc           4 rules   active
       …
```

The list is in groups, one for each directory of the repository, which is how
a rules repository says what a policy shields.

| part | meaning |
|---|---|
| the heading | the directory the policies under it are in |
| the number | a shortcut for the policy's name |
| `✔` / `✘` | it compiles, or the error that stops it |
| `rules:http/crawlers.pfc` | its name: remote, then path |
| `▸ … active` | the one in place now |
| `active at a1b2c3d, this is b58a001` | the one in place is an older version; apply it to move forward |
| the indented lines | what the policy says about itself: description, CVEs, severity, what it patches, tags |
| `knob …` | a value you can set; see [Knobs](knobs.md) |

The running service does the compiling, so `ls` needs pfw to be up. When it
is not, you get the bare list.

### Finding one

With more than a screenful, narrow it:

```sh
pfw ls log4j                      # a word: in the name, description, a CVE, a tag, or what it patches
pfw ls CVE-2021-44228             # so a CVE number finds its policy
pfw ls --tag java                 # by tag
pfw ls --severity critical        # by severity
pfw ls rules                      # one remote, by its name
```

They combine, and each narrows further:

```sh
pfw ls --tag java --tag rce --severity critical
pfw ls rules tomcat
```

```
apps
  1 ✔ rules:apps/confluence-remote-api.pfc  3 rules
  4 ✔ rules:apps/roller-xmlrpc.pfc          2 rules

runtimes
▸ 8 ✔ rules:runtimes/log4shell.pfc          4 rules   active

3 of 10 policies
```

| filter | chooses |
|---|---|
| a word | policies with it in their name, description, CVEs, tags or what they patch; several words, all of them |
| a remote's name | that remote's policies |
| `--tag TAG`, `-t` | policies carrying the tag; given twice, both |
| `--severity LEVEL`, `-s` | `critical`, `high`, `medium` or `low`; given twice, either |

Matching ignores upper and lower case. **A number is the same in a narrowed
list as in the whole one**, so you can find a policy with a filter and apply
it by the number you see.

**Numbers are for now, all the same.** They follow the whole list, so a pull
that adds or removes a policy shifts them. In a script, and anywhere it
matters, use the name.

## Applying

```sh
pfw apply 2                          # by number
pfw apply rules:http/crawlers.pfc    # by name
pfw apply http/crawlers.pfc          # the path alone, when there is one remote
pfw apply -f ./mine.pfc              # a file, no git involved
pfw apply                            # lists them and asks
```

`pfw load` is another name for `apply`.

- **It is checked first.** A policy with a mistake is refused, with the line,
  and the one running stays in place.
- **It swaps in at once.** The next packet meets the new policy. Connections
  already being tracked, and standing bans, carry over.
- **Rule counts start from zero** for the new policy.
- **It is remembered.** After a restart pfw comes back enforcing it.

## Shadow mode

```sh
pfw shadow        # on
pfw unshadow      # off
```

In shadow mode the policy decides and counts exactly as usual, and every
packet passes. `pfw status` shows it on the first line and adds
`would block N`: what would have been stopped.

Use it whenever a policy is new to you:

```sh
pfw shadow
pfw apply 2
# ... let real traffic through ...
pfw status
pfw unshadow
```

Shadow mode belongs to the firewall, not to a policy: it stays on across
`apply` and across restarts until you turn it off.

## Clearing

```sh
pfw clear
```

Removes the policy. Everything passes, pfw stays attached and keeps counting
packets. This is the fast way out when a policy is blocking something it
should not. Bans already in place still stand until they expire.

## The states pfw can be in

<!-- diagram: states -->
```mermaid
stateDiagram-v2
    [*] --> Down
    Down --> Passing: pfw up
    Passing --> Down: pfw down

    state "up, no policy: everything passes" as Passing
    state "shadow: decides and counts, blocks nothing" as Shadow
    state "enforcing: verdicts are real" as Enforcing
    state "attached to nothing: filters nothing, keeps its policy" as Detached
    state "down: not running, nothing is filtered" as Down

    Passing --> Shadow: pfw shadow, then pfw apply
    Passing --> Enforcing: pfw apply
    Shadow --> Enforcing: pfw unshadow
    Enforcing --> Shadow: pfw shadow
    Shadow --> Passing: pfw clear
    Enforcing --> Passing: pfw clear

    Enforcing --> Detached: pfw detach, the last interface
    Detached --> Enforcing: pfw attach

    Enforcing --> Down: pfw down
    Shadow --> Down: pfw down
    Down --> Enforcing: pfw up, as it was left
```
<!-- /diagram -->

## More than one policy at once

Not today. `apply` replaces what is running. To combine two policies, their
rules have to be written into one file.
