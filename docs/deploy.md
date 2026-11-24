# Deploying pfw, step by step

A checklist for putting pfw in front of real traffic without surprises. Do
the steps in order. Each ends with **Check**, which tells you what you should
see before going on, and **If not**, which tells you what to do instead.

Nothing here blocks anything until step 9, and every step before that can be
undone by `pfw down`. Step 9 undoes itself unless you confirm it.

If you only want to see pfw work on a test machine,
[Getting started](getting-started.md) is the five-minute version.

---

## Before you touch anything

### 1. Keep a way back in

You are about to put a program between the network and this machine. Before
you do:

- **Keep a second terminal logged in** to the machine for the whole of this,
  and do not close it.
- **Know how you would reach the machine if the network stopped working**:
  your cloud provider's console, a serial console, someone on site.

The public policies do not touch SSH. One you write yourself might.

**Check:** you have two sessions open, and you know your way in without the
network.

### 2. Know what you are protecting

Answer these three before you start. Write the answers down.

| question | how to find out | example |
|---|---|---|
| Which interface does traffic arrive on? | after installing, `pfw interfaces` marks it `default route`; before, `ip route show default` — the name after `dev` | `eth0` |
| Which port is the service on? | `sudo ss -ltnp` — the port your web server is listening on | `80` |
| Is that traffic encrypted when it reaches this machine? | Is it HTTPS, ending on this machine? | see below |

**The encryption question decides whether pfw can help.** pfw reads traffic
as it is on the wire. If visitors reach this machine over HTTPS, and this
machine is what decrypts it, then pfw sees only scrambled bytes, and a rule
that looks for text in a request will never match.

| your setup | can pfw read requests? | what to do |
|---|---|---|
| plain HTTP on this machine | yes | use the port it listens on |
| HTTPS ends at a load balancer or CDN, which forwards plain HTTP here | yes | use the port the forwarded traffic arrives on |
| HTTPS ends on this machine (nginx, Caddy, etc. with a certificate here) | no, not on the public port | pfw can still filter by port and address; for content rules, run it where the traffic is plain. If that is `lo` on this machine, read the limit below first |

**A limit on `lo`.** pfw reads the first 2 KB of each segment. On a network
card that is the whole segment. On loopback a segment can be 64 KB, so a
request padded past 2 KB is not read there, and a content policy can be
walked past. If your plain traffic exists only between a TLS terminator and
an app on the same machine, pfw on `lo` is a partial guard, not a complete
one. `pfw status` shows an `unread` line when it has happened.

**Check:** you have an interface name, a port, and you know the traffic on
that port is not encrypted.

**If not:** stop here. A content policy on encrypted traffic does nothing,
silently.

---

## Install

### 3. Run the installer

```sh
curl -fsSL https://raw.githubusercontent.com/yeet-src/pfw/master/install.sh | sh
```

It will ask for your password (for `sudo`) and, the first time, open a yeet
login in your browser or print a link to open.

**Check:** the last lines read

```
✔ done        the firewall is up, passing everything until a policy is applied
```

**If not:** the line starting `✘` says what stopped it, and the line under it
says what to do. Fix that and run the same command again; it picks up where
it left off.

### 4. Ask the doctor

```sh
pfw doctor
```

**Check:** no line starts with `✘`, and the last line starts with `✔` or `▲`.
A `▲` about "no policy" is expected: you have not applied one yet.

**If not:** each `✘` has its fix printed under it. See
[Troubleshooting](troubleshooting.md).

---

## Point it at your traffic

Steps 5 to 8 are what `pfw setup` does, asking you the same questions. Run
it instead if you like, then pick this guide up again at the **Now wait**
of step 8.

### 5. Attach to your interface

List the interfaces. The one marked `default route` is where traffic from
the network arrives, and the last line gives you the command for it:

```sh
pfw interfaces
```

Attach to it, with its name in place of `eth0`, and let go of `lo`:

```sh
pfw attach eth0
pfw detach lo
```

**Check:**

```sh
pfw status
```

shows `on eth0`, and `packets … seen` goes up each time you run it. That
number climbing means pfw is seeing your traffic.

**If not:**

- `another XDP program holds one of its interfaces`: something else is
  already attached there. See [Interfaces](interfaces.md).
- `seen` stays at 0: wrong interface. `pfw interfaces` lists them all.

Nothing is blocked yet. There is no policy.

---

## Choose a policy

### 6. Download the policies and read the list

```sh
pfw pull
pfw ls
```

```
  1 ✔ rules:baseline/pass.pfc  1 rule
      Passes everything: attached and counting, deciding nothing.
      #baseline
  2 ✔ rules:http/crawlers.pfc  2 rules
      Resets AI crawlers on a web port by user-agent.
      #http  #crawlers
      knob  port  80  The port to guard.
```

With a long list, narrow it: `pfw ls log4j`, `pfw ls --tag java`,
`pfw ls --severity critical`, or a CVE number, `pfw ls CVE-2021-44228`. See
[Finding one](policies.md#finding-one).

How to choose:

1. **Read the description line** under each. It says what the policy stops.
2. **Check the `✔`.** A `✘` means the policy has an error; do not use it.
3. **Look for CVE numbers and a severity**, if you are here because of a
   specific vulnerability.
4. **Read the `knob` lines.** Those are the settings you may need to change,
   and the value shown is what it will use if you do not.
5. **Read the file itself** if you want to be sure. It is short:

   ```sh
   cat ~/.cache/pfw/remotes/rules/http/crawlers.pfc
   ```

You can run **one policy at a time.** Pick the one that matters most.

**Check:** you have chosen a policy and noted its name, the part like
`rules:http/crawlers.pfc`. The number in front is a shortcut for it, and
changes whenever the list does, so this guide uses the name.

### 7. Set its knobs

If the port from step 2 is not the policy's default, change it. Use your
policy's name and your port:

```sh
pfw knob ls rules:http/crawlers.pfc
pfw knob set rules:http/crawlers.pfc port 8080
```

**Check:** `pfw knob ls rules:http/crawlers.pfc` shows your value, marked
`set`.

**If the policy has no knobs,** skip this step.

---

## Try it without blocking

### 8. Apply it in shadow mode

Shadow mode is a rehearsal. The policy looks at every packet and decides, and
pfw counts what it *would* have blocked, and blocks nothing.

```sh
pfw shadow
pfw apply rules:http/crawlers.pfc
```

**Check:**

```sh
pfw status
```

shows `shadow mode: nothing is blocked` on the first line, and your policy's
name on the second.

**Now wait.** Leave it running through a normal stretch of traffic. An hour
is the least; a full day is better, so it sees your busy time and your quiet
time.

Then look:

```sh
pfw status
```

```
  packets  210k seen   pass 210k   drop 0   rst 0   cut off 0   would block 1.4k
  rules    crawler 1.4k
```

Ask yourself:

- **Is `would block` about what you expected?** Zero may mean the policy is
  on the wrong port, or the traffic is encrypted (step 2).
- **Is it far too high?** If it would block a large share of everything, it
  is catching real visitors. Do not go on.
- **Does your site still work?** It should: nothing is being blocked.

**If the numbers look wrong:** change a knob (step 7) or choose a different
policy (step 6), and wait again. To back out completely: `pfw clear`.

---

## Turn it on

### 9. Enforce it, on trial

Make the policy real for ten minutes:

```sh
pfw unshadow --confirm 10m
```

It is blocking from the next packet. Unless you confirm it, the firewall
undoes this by itself when the ten minutes are up and goes back to
rehearsing. If the policy cuts off something you need, including your own
access, you wait and it is gone. The timer is inside the firewall, so it
does not depend on your terminal staying open.

`pfw status` counts it down:

```
  trial    undone in 9m 41s   pfw confirm keeps it, pfw rollback undoes it now
```

**Check, straight away, from your second terminal and from a browser:**

- your site loads;
- you can still log in to the machine;
- `pfw status` says `enforcing`, and `drop` or `rst` are counting.

**If anything is wrong:**

```sh
pfw rollback
```

It is back to rehearsing at once. Or do nothing, and the deadline does it.

**If everything is right,** keep it:

```sh
pfw confirm
```

**Check:** `pfw status` says `enforcing` and has no `trial` line.

You are now protected.

---

## Keep it running

### 10. Make sure it survives a reboot

pfw remembers its interfaces, its policy, its knobs and shadow mode, and
comes back with them. Confirm it once:

```sh
pfw restart
pfw status
```

**Check:** the same interface and the same policy, `enforcing`.

### 11. Watch it

Day to day:

```sh
pfw status      # one screen
pfw metrics     # the dashboard; q to leave
```

`pfw status` exits with an error when pfw is not up, so a monitoring check
can be as simple as:

```sh
pfw status >/dev/null || echo "pfw is down"
```

If you run Prometheus, pfw publishes metrics on this machine at
`http://127.0.0.1:9477/metrics`. A scrape job, a set of alerts and a Grafana
dashboard are ready to copy from
[`contrib/`](https://github.com/yeet-src/pfw/tree/master/contrib). The three
alerts worth having:

| alert when | means |
|---|---|
| `pfw_up == 0` | pfw is not filtering |
| `pfw_policy_enforcing == 0` | there is no policy in place |
| `pfw_shadow == 1` for more than a day | someone left the rehearsal on |

See [Metrics](metrics.md) for all of them, and [Security](security.md)
before you let another machine reach that port.

### 12. Keep the policies current

Once a week, or when you hear of something new:

```sh
pfw pull        # says what changed
pfw ls          # your policy is marked; "active at …, this is …" means a newer version is here
```

To move to the newer version, rehearse it first, the same as before:

```sh
pfw shadow
pfw apply rules:http/crawlers.pfc
# watch pfw status for a while
pfw unshadow --confirm 10m
pfw confirm
```

Pulling never changes what is running. Only `apply` does. If the newer
version turns out worse, `pfw rollback` returns to the one you had.

### 13. Upgrade pfw itself

```sh
pfw upgrade
```

pfw restarts onto the new version and comes back as it was. For the few
seconds that takes, traffic is not filtered.

---

## The whole thing on one page

```sh
# before: a second terminal open, and a way in without the network
ip route show default                 # your interface
sudo ss -ltnp                         # your port

curl -fsSL https://raw.githubusercontent.com/yeet-src/pfw/master/install.sh | sh
pfw doctor

pfw interfaces                        # which one is "default route"
pfw attach eth0 && pfw detach lo      # that one
pfw pull && pfw ls                    # choose a policy, note its name
pfw knob set rules:http/crawlers.pfc port 80    # your policy, your port (if it has the knob)

pfw shadow && pfw apply rules:http/crawlers.pfc # rehearse
pfw status                            # after a while: read "would block"

pfw unshadow --confirm 10m            # enforce, on trial
# check the site and your login, then:
pfw confirm                           # keep it
```

## Getting out

| you want to | run |
|---|---|
| undo a trial now | `pfw rollback` |
| go back to the policy you had before | `pfw rollback` |
| stop blocking, keep pfw running | `pfw clear` |
| go back to rehearsing | `pfw shadow` |
| stop pfw entirely | `pfw down` |
| remove pfw from the machine | `pfw uninstall` |
