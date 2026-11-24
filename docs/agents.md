# Setting pfw up with an AI agent

If you use a coding agent that can run commands in a terminal (Claude Code,
Cursor, Codex and the like), it can do the setup for you. Open the agent on
the machine you want to protect and paste one of the prompts below.

Every prompt tells the agent to stop and ask before anything that changes
what traffic reaches your machine. Read what it shows you before you say yes.

- [Install it](#1-install-it)
- [Deploy a policy safely](#2-deploy-a-policy-safely)
- [Write a policy for me](#3-write-a-policy-for-me)
- [Something is wrong](#4-something-is-wrong)
- [Set up monitoring](#5-set-up-monitoring)
- [What an agent needs to know](#what-an-agent-needs-to-know), to paste in
  front of a prompt of your own

---

## 1. Install it

```text
Install pfw on this machine. pfw is a Linux firewall that inspects packet
contents; its docs are at https://github.com/yeet-src/pfw.

Do this:
1. Check this is Linux with kernel 6.1 or newer (uname -sr), and that git
   and curl are installed. If not, tell me what is missing and stop.
2. Run the installer:
   curl -fsSL https://raw.githubusercontent.com/yeet-src/pfw/master/install.sh | sh
   It needs sudo and a yeet login. If it prints a login link or asks for a
   password, show me and wait for me. Do not try to answer for me.
3. Run `pfw doctor` and show me its full output.
4. Run `pfw status` and show me.

Rules:
- If any step fails, show me the exact error and the fix it suggests. Do
  not try workarounds, and do not edit pfw's files.
- Do not attach pfw to any interface and do not apply any policy. Stop
  after step 4.
- Do not change the listen address in service.toml.

When done, tell me in two sentences what state pfw is in.
```

## 2. Deploy a policy safely

Use this once pfw is installed.

```text
Help me deploy a pfw policy on this machine, safely. pfw is installed. Its
step-by-step guide is at
https://github.com/yeet-src/pfw/blob/master/docs/deploy.md — follow that
order.

First, find out and tell me, without changing anything:
- `pfw doctor` and `pfw status` output
- `pfw interfaces`, which marks the interface the default route uses
- which ports are listening (sudo ss -ltnp), and which looks like the web
  service
- whether traffic on that port is likely encrypted on arrival (is something
  on this machine terminating TLS on it?). pfw cannot read encrypted
  contents, so say clearly if a content policy would be useless here.

Then stop and ask me to confirm the interface and the port.

After I confirm:
1. `pfw pull`, then `pfw ls`. Show me the full list and recommend one
   policy, saying why, quoting its description. Ask me which to use.
   Refer to policies by name (remote:path): the numbers in the list shift
   when the repository changes.
2. Run setup with my answers, which attaches to the interface, sets the
   knob and applies the policy in shadow mode, blocking nothing:
   `pfw setup --yes --iface <interface> --policy <remote:path>`
   adding `--knob port=<port>` if the policy has a `port` knob and my port
   differs from its default.
3. Show me `pfw status` and confirm the "seen" count is rising. Tell me to
   let it run through real traffic, and that you will check "would block"
   when I come back.

Stop there. Do NOT run `pfw unshadow`. Enforcing is my decision, and I
will ask for it separately.

Rules:
- Ask before every command that needs sudo.
- Never run `pfw unshadow`, `pfw down`, or anything that edits
  service.toml, unless I ask in so many words.
- If a command fails, show me the error and stop.
- Use `pfw --json status` when you need to read values exactly.
```

When you come back and the numbers look right:

```text
Show me `pfw status`. Tell me how many packets pfw has seen, how many it
would have blocked, and by which rules. Say whether that share looks
plausible for the policy's description, and flag it if "would block" is 0
or is more than a few percent of everything.

If I then say to go ahead:
1. Run `pfw unshadow --confirm 10m`. That enforces the policy on trial: the
   firewall undoes it by itself after ten minutes unless it is confirmed.
   Never use plain `pfw unshadow`.
2. Immediately check: `pfw status`, and curl the local web service to
   confirm it still answers.
3. Tell me to check my site and my own login from another terminal.
4. Only when I say everything works, run `pfw confirm`. If I say anything
   is wrong, run `pfw rollback` at once. If I do not answer, do nothing:
   the trial ends by itself.
```

## 3. Write a policy for me

```text
Write a pfw policy for me. pfw policies are files in a small language
called pfw-C. Before writing anything, read:
- https://github.com/yeet-src/pfw/blob/master/docs/writing-policies.md
- the language reference:
  https://github.com/yeet-src/pfw-core/blob/master/docs/lang.md
- two or three similar examples under
  https://github.com/yeet-src/pfw-core/tree/master/contrib

What I want it to do:
  <describe it: what to block, on which port, and what must never be blocked>

Requirements:
- One file, ending .pfc.
- Start with the metadata block: @description, @tags, and a @knob line for
  every knob. Add @cve, @severity and @patches only if they truly apply.
- Read the port from a knob with a sensible default, not a constant.
- Give every blocking verdict a name, so it is counted as a rule.
- Whatever the policy does not decide, it must pass. End the filter with
  `decide pass;`.
- Never drop or reset SSH (port 22) unless I asked for that explicitly.

Then test it without affecting traffic:
1. `pfw shadow` (if not already on), then `pfw apply -f ./<file>.pfc`.
   If it does not compile, fix the reported line and try again. The policy
   that was running is not touched by a failed apply.
2. Show me `pfw status` and `pfw knob ls`.

Do not run `pfw unshadow`. Explain the policy to me line by line, and tell
me what traffic I should send to see "would block" go up.
```

## 4. Something is wrong

```text
pfw on this machine is not behaving as I expect. Diagnose it. Do not
change anything until you have told me what you found and I have agreed.

What I am seeing:
  <describe it>

Gather, and show me:
- `pfw doctor`
- `pfw --json status`
- `pfw knob ls` (if a policy is in place)
- `pfw remote ls`
- `yeet service tree pfw`
- `timeout 5 pfw logs` (what the firewall says, live, while you run
  `pfw status` in another shell)
- `ip -br link` and, for each interface pfw is on, `ip link show <iface>`

Then read https://github.com/yeet-src/pfw/blob/master/docs/troubleshooting.md
and tell me:
1. what is wrong, in one sentence;
2. the evidence, quoting the output;
3. the fix, as exact commands, and what each one changes.

Common causes to rule out: shadow mode is on; pfw is on the wrong
interface; the traffic is encrypted, so a content policy cannot match; a
knob points at the wrong port; the running service is behind its installed
build (doctor's "version" line); this host is not logged in to yeet.

If I am locked out of something or traffic is being wrongly blocked, say
so first and offer `pfw rollback`, which returns to the policy before, or
`pfw clear`, which lets everything through. Both act at once and neither
stops pfw.
```

## 5. Set up monitoring

```text
Set up monitoring for pfw on this machine. pfw serves Prometheus metrics at
http://127.0.0.1:9477/metrics. The metric list is at
https://github.com/yeet-src/pfw/blob/master/docs/metrics.md

0. Ready-made files are in
   https://github.com/yeet-src/pfw/tree/master/contrib : a scrape job
   (prometheus/scrape.yml), alert rules (prometheus/alerts.yml) and a
   Grafana dashboard (grafana/pfw.json). Use them rather than writing new.
1. Confirm the endpoint answers: curl -s http://127.0.0.1:9477/metrics | head
2. Find out whether Prometheus runs on this machine, and where its config
   is. If it runs elsewhere, stop and tell me: pfw's port is local-only on
   purpose, and has no password. Read
   https://github.com/yeet-src/pfw/blob/master/docs/security.md and
   propose an SSH tunnel or a private-network address. Do not bind pfw to
   0.0.0.0.
3. Show me the scrape job you would add, and these alert rules, before
   writing either:
   - pfw_up == 0 for 2m                       (pfw is not filtering)
   - yeet_worker_up == 0 for 2m               (the firewall is not answering)
   - pfw_policy_enforcing == 0 for 5m         (no policy in place)
   - pfw_shadow == 1 for 24h                  (shadow mode left on)
   - rate(pfw_faults_total[5m]) > 0           (policy runs failing)
   - rate(pfw_events_dropped_total[5m]) > 0   (events being lost)
4. After I approve, add them, reload Prometheus, and show me that the pfw
   target is up.
```

---

## What an agent needs to know

Paste this ahead of a request of your own, so the agent does not have to
guess how pfw works.

```text
You are working with pfw, a Linux firewall that inspects packet contents at
XDP. Docs: https://github.com/yeet-src/pfw/tree/master/docs

How it works:
- One long-running service (run by yeet) owns the firewall. The `pfw`
  command talks to it. `pfw up` starts it, `pfw down` stops it.
- It filters the interfaces it is attached to: `pfw attach IFACE`,
  `pfw detach IFACE`. `pfw interfaces` lists them and marks the one the
  default route uses, which is where traffic from the network arrives.
- It runs ONE policy at a time. A policy is a .pfc file. `pfw apply`
  replaces whatever is running.
- Policies come from git repositories ("remotes"): `pfw remote ls`,
  `pfw pull`, `pfw ls`. `pfw ls` narrows by a word (`pfw ls log4j`, or a CVE
  number), `--tag TAG` and `--severity LEVEL`. `rules`
  (github.com/yeet-src/pfw-rules) is there by
  default. A policy is named as `remote:path` (stable) or by its number in
  `pfw ls` (a shortcut that shifts when the list changes: prefer the name).
- A knob is a value a policy reads, such as a port: `pfw knob ls`,
  `pfw knob set NAME VALUE`. Knobs are per policy and change live.
- Shadow mode (`pfw shadow` / `pfw unshadow`) is a dry run: verdicts are
  counted as "would block" and nothing is blocked.
- `pfw clear` removes the policy: everything passes, pfw stays up.
- A change that starts blocking can be made on trial:
  `pfw unshadow --confirm 10m` or `pfw apply POLICY --confirm 10m`. The
  firewall undoes it at the deadline unless `pfw confirm` comes first.
  `pfw rollback` undoes a trial at once; with no trial, it returns to the
  policy before the current one.
- `pfw setup --yes --iface IFACE --policy POLICY [--knob NAME=VALUE]` does
  attach, pull, knobs and apply-in-shadow in one step, blocking nothing.
- State (interfaces, policy, knobs, shadow) survives restarts. A restart
  during a trial comes back to what was running before the trial.

Reading its state:
- `pfw doctor` checks everything and prints the fix for what is wrong.
  Start there whenever something is off.
- `pfw status` exits non-zero when the firewall is down.
- `pfw logs` follows what the firewall says, live, until interrupted: run
  it under `timeout`.
- Add `--json` before the command for machine-readable output:
  `pfw --json status`.
- `pfw metrics` opens a full-screen app on a terminal. In a script or an
  agent, use `pfw --json metrics` or `pfw metrics | cat`.

Limits you must respect:
- pfw sees traffic as it is on the wire. It cannot read inside TLS/HTTPS.
  A content rule on encrypted traffic never matches.
- Its port (127.0.0.1:9477) has no authentication. Never change it to
  0.0.0.0 or expose it without the user's explicit decision.
- An interface can hold one XDP program. If attach fails with "another XDP
  program holds one of its interfaces", do not try to remove the other
  program; tell the user.
- Applying a broken policy is safe: it is refused with the line number and
  the running policy is untouched.

Safety rules for you:
- Never run `pfw unshadow`, `pfw down`, or `pfw apply` outside shadow mode
  without the user saying so explicitly.
- Enforce only on trial: `pfw unshadow --confirm 10m`, and `pfw confirm`
  only once the user says all is well.
- If the user reports being blocked or locked out: `pfw rollback` or
  `pfw clear` first, questions after.
- Never run `pfw uninstall` or `pfw upgrade` unless asked in so many words.
- Ask before any command that needs sudo.
- Do not edit files under /usr/local/share/pfw or /var/lib/pfw by hand.
```
