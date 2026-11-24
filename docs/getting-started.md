# Getting started

From a fresh [install](install.md) to a policy that is really blocking, in
six steps. Each shows what you should see.

## 1. See that it is up

```sh
pfw status
```

```
● pfw  up 12s   on lo
  policy   none: passing everything
  packets  48 seen   pass 0   drop 0   rst 0   ban 0
```

- **`up`** and the green dot: the firewall is running.
- **`on lo`**: it is attached to `lo`, the *loopback* interface, which is
  traffic from this machine to itself. pfw starts there because nothing you
  care about breaks there.
- **`policy none`**: it has no rules yet, so everything passes.

If you see `the pfw service is not reachable`, run `pfw up`, and if that
fails, `pfw doctor`.

## 2. Choose the interface to protect

```sh
pfw attach
```

```
▸ lo     ifindex 1   up   attached
  eth0   ifindex 2   up
```

That lists your machine's network interfaces. The one facing the network is
usually called `eth0`, `ens5`, `enp1s0` or similar. Attach to it, and let go
of `lo`:

```sh
pfw attach eth0
pfw detach lo
```

Still nothing is blocked: there is no policy. More in
[Interfaces](interfaces.md).

## 3. Get some policies

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

`pull` downloads the policies from the public
[pfw-rules](https://github.com/yeet-src/pfw-rules) repository; `ls` lists
them. Reading one entry:

- **`2`** is its number, the short way to name it.
- **`✔`** means it compiles. A `✘` would show the error instead.
- **`rules:http/crawlers.pfc`** is its full name: the repository, then the
  file.
- The next line is what it does, then its tags.
- **`knob port 80`** is a value you can change without editing the policy.
  See [Knobs](knobs.md).

## 4. Try one without blocking anything

```sh
pfw shadow
pfw apply 2
```

`shadow` turns on the dry run. `apply 2` puts policy 2 in place. Now let some
traffic through for a while, then look:

```sh
pfw status
```

```
● pfw  up 4m 10s   on eth0   shadow mode: nothing is blocked
  policy   rules:http/crawlers.pfc @ b58a001   shadow (dry run)   applied 2m ago
  packets  1.9k seen   pass 1.9k   drop 0   rst 0   ban 0   would block 37
  rules    crawler 37
```

**`would block 37`** is the number to read: what the policy would have
stopped, had it been real. `rules` says which rule would have stopped them.

If that looks right, and nothing you need is in it, go on. If not, try
another policy, or [change a knob](knobs.md), and look again.

## 5. Enforce it

```sh
pfw unshadow
```

From the next packet, the policy is real. `pfw status` now says `enforcing`,
and `rst`, `drop` or `ban` start to count.

## 6. Watch it work

```sh
pfw metrics
```

This opens the dashboard. `1` to `4` or a click change page, the arrow keys
and the mouse wheel scroll, and `q` leaves. [Metrics](metrics.md) explains
every box.

## The loop

That is all of it:

**pull → list → shadow → apply → check → unshadow**

## Where next

- [Using policies](policies.md): your own repositories, updating, clearing.
- [Writing a policy](writing-policies.md): make one of your own.
- [Security](security.md): before pfw's port is reachable from anywhere else.
- If you lock yourself out of something: `pfw clear` lets everything through
  again without stopping pfw.
