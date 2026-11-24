/* The control commands, run in the firewall worker. Each takes the
 * firewall, the request as the keeper read it (`rest` of the header and
 * the policy `sources`) and the saved state, and returns a result: the view
 * that renders it, its data, whether it succeeded, and a notice saying what
 * changed.
 *
 *   status
 *   metrics                     everything the VM has counted
 *   interfaces [default=..] [xdp=..]   the host's interfaces: which are attached,
 *                               and which to attach to
 *   attach <name>[,<name>...]   attach to these interfaces as well
 *   detach <name>[,<name>...]   let go of these interfaces
 *   apply [confirm=<time>]      compile its one source and enforce it
 *   clear                       stop enforcing, and pass everything
 *   shadow                      dry run: decide and count, block nothing
 *   unshadow [confirm=<time>]   enforce again
 *   confirm                     keep what is on trial
 *   rollback                    undo the trial, or go back to the policy before
 *
 * `confirm=<time>` puts the change on trial: it is undone after that long
 * unless `confirm` comes first (src/fw/trial.js).
 *   check [<filter>...]         compile its sources, change nothing, and list
 *                               the ones the filters choose (src/ctl/select.js)
 *   knobs                       a policy's knobs and what each holds
 *   knob-set <knob> <value>     set one, for that policy
 *   knob-unset <knob>           back to the policy's default
 *   saved                       the firewall's state, as a module to keep
 *
 * The knob commands are about their one source when they carry one, else
 * the policy enforcing.
 */
import { listInterfaces, resolveInterfaces } from "#/fw/interfaces.js";
import { parseMeta } from "#/fw/meta.js";
import { Policy, PolicyError } from "#/fw/policy.js";
import { parseSpan } from "#/fw/trial.js";
import { duration } from "#/ctl/render/format.js";
import { confirmOf } from "#/ctl/request.js";
import { isFiltering, parseFilters, select } from "#/ctl/select.js";

const statusOf = async (firewall, notice) => {
  const data = await firewall.report();
  return { view: "status", ok: data.running, data, notice };
};

/* Makes a change, on trial when the request asks for one. The time is
 * read before anything changes, so a bad one changes nothing, and the
 * snapshot is taken ahead of the change it is the way back from.
 */
async function onTrial(firewall, rest, change, notice) {
  const asked = confirmOf(rest);
  const ms = asked === null ? null : parseSpan(asked);
  const before = firewall.snapshot();

  await change();
  if (ms === null) return statusOf(firewall, notice);

  firewall.tryFor(ms, before);
  return statusOf(firewall, `${notice}, on trial: undone in ${duration(ms)} unless you run pfw confirm`);
}

// The interfaces a header names, which must be at least one.
function named(rest) {
  const names = rest.split(",").map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) throw new Error("Name at least one interface");
  return names;
}

// A policy that does not compile still says what it is for.
function checked(firewall, { name, source }) {
  const meta = parseMeta(source);
  try {
    const policy = new Policy(name, source);
    return { name, ok: true, rules: policy.rules, errors: [], meta, knobs: firewall.knobs.of(policy) };
  } catch (error) {
    if (!(error instanceof PolicyError)) throw error;
    return { name, ok: false, rules: [], errors: error.errors, meta, knobs: [] };
  }
}

// The policy a knob command is about, and its arguments past the count.
function knobRequest(firewall, { rest, sources: [given] }) {
  const policy = given ? new Policy(given.name, given.source) : firewall.knobTarget;
  return { policy, args: rest.replace(/^[01] ?/, "") };
}

function knobsOf(firewall, policy, notice) {
  const key = policy.key;
  const state = firewall.policy?.key === key ? "enforcing" : "other";
  return { view: "knobs", ok: true, notice, data: { policy: policy.name, state, knobs: firewall.knobs.of(policy) } };
}

export const commands = {
  status: (firewall) => statusOf(firewall),

  async metrics(firewall) {
    const attached = firewall.interfaces.length > 0;
    const { rates } = firewall;
    return {
      view: "metrics",
      ok: true,
      data: { attached, stats: await firewall.stats(), speeds: rates.speeds(), ruleSpeeds: rates.ruleSpeeds(), window: rates.seconds },
    };
  },

  // Where the firewall's state is saved, and the module to save there.
  saved: (firewall, _request, state) => ({
    view: "saved",
    ok: true,
    data: { path: state.path, module: state.moduleOf(firewall) },
  }),

  /* What the service cannot see of the host, the command tells it:
   * `default=<names>` is the interfaces the default route goes through, and
   * `xdp=<names>` the ones with an XDP program on them. One of those that
   * pfw is not attached to belongs to something else.
   */
  async interfaces(firewall, { rest }) {
    const told = Object.fromEntries(rest.split(" ").filter(Boolean).map((word) => word.split("=")));
    const names = (list) => (list ?? "").split(",").filter(Boolean);
    const attached = firewall.interfaces.map((i) => i.name);

    return {
      view: "interfaces",
      ok: true,
      data: { available: await listInterfaces(), attached, defaults: names(told.default), busy: names(told.xdp).filter((name) => !attached.includes(name)) },
    };
  },

  async attach(firewall, { rest }) {
    const added = await resolveInterfaces(named(rest));
    const held = firewall.interfaces;
    const fresh = added.filter((a) => !held.some((h) => h.index === a.index));
    if (fresh.length > 0) await firewall.attach([...held, ...fresh]);
    return statusOf(firewall, `attached to ${added.map((i) => i.name).join(", ")}`);
  },

  async detach(firewall, { rest }) {
    const dropped = named(rest);
    const held = firewall.interfaces;
    const missing = dropped.filter((d) => !held.some((h) => h.name === d || String(h.index) === d));
    if (missing.length > 0) throw new Error(`Not attached to ${missing.join(", ")}`);

    await firewall.attach(held.filter((h) => !dropped.includes(h.name) && !dropped.includes(String(h.index))));
    return statusOf(firewall, `detached from ${dropped.join(", ")}`);
  },

  async clear(firewall) {
    const cleared = firewall.policy;
    if (!cleared) throw new Error("No policy is enforcing");
    await firewall.clear();
    return statusOf(firewall, `cleared ${cleared.name}: passing everything`);
  },

  // Compiled first: one that does not compile leaves the running policy alone.
  apply(firewall, { rest, sources: [{ name, source }] }) {
    const policy = new Policy(name, source);
    return onTrial(firewall, rest, () => firewall.enforce(policy), `applied ${name}`);
  },

  async shadow(firewall) {
    await firewall.setShadow(true);
    return statusOf(firewall, "shadow mode on: verdicts are counted, nothing is blocked");
  },

  unshadow: (firewall, { rest }) =>
    onTrial(firewall, rest, () => firewall.setShadow(false), "shadow mode off: verdicts are enforced"),

  confirm(firewall) {
    if (!firewall.confirm()) throw new Error("Nothing is on trial: there is nothing to confirm");
    return statusOf(firewall, "confirmed: it stays");
  },

  async rollback(firewall) {
    const undoing = firewall.trial.pending;
    await firewall.rollback();
    const now = firewall.policy?.name ?? "no policy: passing everything";
    return statusOf(firewall, undoing ? `rolled back the trial: ${now}` : `rolled back to ${now}`);
  },

  knobs(firewall, request) {
    return knobsOf(firewall, knobRequest(firewall, request).policy);
  },

  async "knob-set"(firewall, request) {
    const { policy, args } = knobRequest(firewall, request);
    const [, name, value] = args.match(/^(\S+) (.*)$/s) ?? [];
    if (!name) throw new Error("Usage: knob set [POLICY] NAME VALUE");
    await firewall.setKnob(policy, name, value);
    return knobsOf(firewall, policy, `${name} = ${value} for ${policy.key}`);
  },

  async "knob-unset"(firewall, request) {
    const { policy, args: name } = knobRequest(firewall, request);
    if (!name) throw new Error("Usage: knob unset [POLICY] NAME");
    await firewall.unsetKnob(policy, name);
    return knobsOf(firewall, policy, `${name} is back to its default for ${policy.key}`);
  },

  /* Every source is compiled and numbered; the filters after the count then
   * choose which are shown, so a number names the same policy however the
   * list was narrowed.
   */
  check: (firewall, { rest, sources }) => {
    const filters = parseFilters(rest.split(" ").slice(1).filter(Boolean));
    const all = sources.map((source, i) => ({ ...checked(firewall, source), number: i + 1 }));
    const entries = select(all, filters);
    return {
      view: "catalog",
      ok: entries.every((e) => e.ok),
      data: { entries, total: all.length, filtered: isFiltering(filters), active: firewall.policy?.name ?? null },
    };
  },
};
