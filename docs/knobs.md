# Knobs

A **knob** is a value a policy reads instead of having it written in: a port,
a threshold, an on/off switch. The policy gives it a default, and you can set
it from outside without editing the file.

The crawler policy guards port 80 unless told otherwise:

```
  2 ✔ rules:http/crawlers.pfc  2 rules
      Resets AI crawlers on a web port by user-agent.
      knob  port  80  The port to guard.
```

## Seeing them

```sh
pfw knob ls          # every policy in place
pfw knob ls 2        # any policy, by number or name
```

```
knobs of rules:http/crawlers.pfc @ b58a001   enforcing
  port  80  default  The port to guard.
```

Each line is a knob: its name, what it holds now, whether that is the
policy's default or something you set, and what it is for.

With [several policies in place](policies.md#several-policies-at-once),
`pfw knob ls` lists each in turn, with the packets it is for:

```
knobs of rules:http/crawlers.pfc @ b58a001   enforcing
  port  80    default            The port to guard.
knobs of rules:http/api.pfc @ b58a001   enforcing   tcp/8443
  port  8443  set, default 80    The port to guard.
```

`pfw ls` shows every policy's knobs under it, and `pfw status` shows the ones
you have set on the policies in place, saying whose each is when there are
several: `port 8443 (rules:http/api.pfc)`.

## Setting one

```sh
pfw knob set port 8080
```

```
✔ port = 8080 for rules:http/crawlers.pfc
knobs of rules:http/crawlers.pfc @ b58a001   enforcing
  port  8080  set, default 80  The port to guard.
```

On a policy in place, it takes effect **on the next packet**. Nothing is
reloaded, and counters and connections are untouched.

With no policy named, it is the policy in place that has a knob of that
name. When several have it, pfw asks you to say which:

```sh
pfw knob set port 8443
```

```
✘ port is a knob of rules:http/crawlers.pfc and rules:http/api.pfc: name one
```

```sh
pfw knob set rules:http/api.pfc port 8443
```

To set a knob on a policy before applying it, name the policy:

```sh
pfw knob set 2 port 8080
pfw apply 2
```

## Putting one back

```sh
pfw knob unset port
```

Back to the policy's own default.

## What to know

- **A value belongs to the policy you set it for.** Two policies that both
  have a `port` do not share one, in place together or not. Setting it on
  one leaves the other alone.
- **A policy in several places has one set of knobs.** The same policy as
  the default and on a route reads the same values in both.
- **It follows the policy, not the version.** Pull a newer version of the
  same file and your value is still there.
- **It is remembered** across restarts.
- **A number is a whole number**, typed in decimal (`8080`) or hex
  (`0x1f90`).
- **Some knobs are text**: a piece of text, up to 64 bytes, that the policy
  looks for in traffic, such as a hostname to block.
  `pfw knob set bad_host evil.example.com`.
- **A knob is one value.** A list of ports is not a knob; the policy would
  need a knob for each.
- **A knob the policy does not have is refused**, and the message lists the
  ones it does.

To give your own policy knobs, see
[Writing a policy](writing-policies.md#knobs).
