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
 *   apply [confirm=<time>] [at=<place>]
 *                               compile its one source and enforce it: as
 *                               the default, or at a place of its own
 *   clear [at=<place>]          stop enforcing, and pass everything; or
 *                               only what is at one place
 *   shadow                      dry run: decide and count, block nothing
 *   enforce [confirm=<time>]    shadow mode off: verdicts are real again
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
 * A place is the default, the chain run first, or a route
 * (src/fw/place.js). The knob commands are about their one source when
 * they carry one. Without it, `knobs` lists every policy in place, and the
 * other two mean the one in place that has the knob.
 */
import { listInterfaces, resolveInterfaces } from "#/fw/interfaces.js";
import { parseMeta } from "#/fw/meta.js";
import { DEFAULT, parsePlace } from "#/fw/place.js";
import { Policy, PolicyError } from "#/fw/policy.js";
import { parseSpan } from "#/fw/trial.js";
import { duration } from "#/ctl/render/format.js";
import { atOf, confirmOf } from "#/ctl/request.js";
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

// The place a header names, or null when it names none.
function placeOf(firewall, rest) {
  const at = atOf(rest);
  return at === null ? null : parsePlace(at, firewall.interfaces);
}

// Where a policy went, for the notice: nothing for the default.
const where = (place) => ({ default: "", first: " to run first", route: ` for ${place.label}` })[place.kind];

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

/* A policy as its opening comments describe it, not compiled: what `pfw ls`
 * shows unless it is asked to check. Reading the comments of twenty policies
 * takes no time; compiling them takes seconds. The knobs are the ones the
 * comments name, with what each is for and no value, except for a policy in
 * place, whose values the firewall already holds.
 */
function listed(firewall, { name, source }) {
  const meta = parseMeta(source);
  const inPlace = firewall.inPlace.find((policy) => policy.name === name);
  const knobs = inPlace
    ? firewall.knobs.of(inPlace)
    : Object.entries(meta.knobs ?? {}).map(([knob, about]) => ({ name: knob, about, set: false, unread: true }));
  return { name, ok: true, checked: false, rules: [], errors: [], meta, knobs };
}

/* The policy in place a knob named with no policy belongs to. One policy in
 * place is the one meant, and says what it has if the knob is not among
 * them; with several, the knob has to be one policy's alone.
 */
function ownerOf(firewall, knob) {
  const inPlace = firewall.inPlace;
  if (inPlace.length === 0) throw new Error("No policy is enforcing: name one");
  if (inPlace.length === 1) return inPlace[0];

  const having = inPlace.filter((policy) => policy.knobs.some((k) => k.name === knob));
  if (having.length === 1) return having[0];
  if (having.length === 0) throw new Error(`No policy in place has a knob ${knob || "of that name"} (pfw knob ls)`);
  throw new Error(`${knob} is a knob of ${having.map((policy) => policy.key).join(" and ")}: name one`);
}

// The policy a knob command is about, and its arguments past the count.
function knobRequest(firewall, { rest, sources: [given] }) {
  const args = rest.replace(/^[01] ?/, "");
  const policy = given ? new Policy(given.name, given.source) : ownerOf(firewall, args.split(" ")[0]);
  return { policy, args };
}

// A policy's knobs, and the places it is in.
function knobsData(firewall, policy) {
  const at = firewall.rules.entries().filter((entry) => entry.policy.key === policy.key).map((entry) => entry.at);
  return { policy: policy.name, state: at.length > 0 ? "enforcing" : "other", at, knobs: firewall.knobs.of(policy) };
}

// `policies` is every policy listed; the first is also the reply's own fields.
function knobsOf(firewall, policies, notice) {
  const each = policies.map((policy) => knobsData(firewall, policy));
  return { view: "knobs", ok: true, notice, data: { ...each[0], policies: each } };
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

  // Every place, or the one named: the others go on as they were.
  async clear(firewall, { rest }) {
    const place = placeOf(firewall, rest);
    const cleared = [...new Set(firewall.rules.entries().filter((entry) => place === null || entry.place.spec === place.spec).map((entry) => entry.policy.name))];
    if (cleared.length === 0) throw new Error(place ? `No policy is in place at ${place.label}` : "No policy is enforcing");

    await firewall.clear(place);
    const still = firewall.rules.entries().length;
    const left = still === 0 ? "passing everything" : still === 1 ? "1 policy is still in place" : `${still} policies are still in place`;
    return statusOf(firewall, `cleared ${cleared.join(", ")}: ${left}`);
  },

  // Compiled first: one that does not compile leaves the running policies alone.
  apply(firewall, { rest, sources: [{ name, source }] }) {
    const place = placeOf(firewall, rest) ?? DEFAULT;
    const policy = new Policy(name, source);
    return onTrial(firewall, rest, () => firewall.enforce(policy, place), `applied ${name}${where(place)}`);
  },

  async shadow(firewall) {
    await firewall.setShadow(true);
    return statusOf(firewall, "shadow mode on: verdicts are counted, nothing is blocked");
  },

  enforce: (firewall, { rest }) =>
    onTrial(firewall, rest, () => firewall.setShadow(false), "shadow mode off: verdicts are enforced"),

  confirm(firewall) {
    if (!firewall.confirm()) throw new Error("Nothing is on trial: there is nothing to confirm");
    return statusOf(firewall, "confirmed: it stays");
  },

  async rollback(firewall) {
    const undoing = firewall.trial.pending;
    await firewall.rollback();
    const now = [...new Set(firewall.rules.entries().map((entry) => entry.policy.name))].join(", ") || "no policy: passing everything";
    return statusOf(firewall, undoing ? `rolled back the trial: ${now}` : `rolled back to ${now}`);
  },

  // The policy it carries, else every one in place.
  knobs(firewall, { sources: [given] }) {
    if (given) return knobsOf(firewall, [new Policy(given.name, given.source)]);
    if (firewall.inPlace.length === 0) throw new Error("No policy is enforcing: name one");
    return knobsOf(firewall, firewall.inPlace);
  },

  async "knob-set"(firewall, request) {
    const { policy, args } = knobRequest(firewall, request);
    const [, name, value] = args.match(/^(\S+) (.*)$/s) ?? [];
    if (!name) throw new Error("Usage: knob set [POLICY] NAME VALUE");
    await firewall.setKnob(policy, name, value);
    return knobsOf(firewall, [policy], `${name} = ${value} for ${policy.key}`);
  },

  async "knob-unset"(firewall, request) {
    const { policy, args: name } = knobRequest(firewall, request);
    if (!name) throw new Error("Usage: knob unset [POLICY] NAME");
    await firewall.unsetKnob(policy, name);
    return knobsOf(firewall, [policy], `${name} is back to its default for ${policy.key}`);
  },

  /* Every source is numbered; the filters after the count then choose which
   * are shown, so a number names the same policy however the list was
   * narrowed. They are compiled only when asked to be (`check=1`, which is
   * `pfw ls --check`): `apply` compiles the one it is given anyway, and
   * refuses it if it does not.
   */
  check: (firewall, { rest, sources }) => {
    const words = rest.split(" ").slice(1).filter(Boolean);
    const compiling = words.includes("check=1");
    const filters = parseFilters(words.filter((word) => word !== "check=1"));
    const all = sources.map((source, i) => ({ ...(compiling ? checked(firewall, source) : listed(firewall, source)), number: i + 1 }));
    const entries = select(all, filters);
    return {
      view: "catalog",
      ok: entries.every((e) => e.ok),
      data: { entries, total: all.length, filtered: isFiltering(filters), active: firewall.rules.entries().map((entry) => entry.policy.name), checked: compiling },
    };
  },
};

// What `enforce` was called before, kept for a `pfw` that still says it.
commands.unshadow = commands.enforce;
