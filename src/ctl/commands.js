/* The control commands, run in the firewall worker. Each takes the
 * firewall, the request as the keeper read it (`rest` of the header and
 * the policy `sources`) and the saved state, and returns a result: the view
 * that renders it, its data, whether it succeeded, and a notice saying what
 * changed.
 *
 *   status
 *   metrics                     everything the VM has counted
 *   interfaces                  the host's interfaces, the attached ones marked
 *   attach <name>[,<name>...]   attach to these interfaces as well
 *   detach <name>[,<name>...]   let go of these interfaces
 *   apply                       compile its one source and enforce it
 *   clear                       stop enforcing, and pass everything
 *   check                       compile its sources and change nothing
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

const statusOf = async (firewall, notice) => {
  const data = await firewall.report();
  return { view: "status", ok: data.running, data, notice };
};

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
    return { view: "metrics", ok: true, data: { attached, stats: await firewall.stats() } };
  },

  // Where the firewall's state is saved, and the module to save there.
  saved: (firewall, _request, state) => ({
    view: "saved",
    ok: true,
    data: { path: state.path, module: state.moduleOf(firewall) },
  }),

  async interfaces(firewall) {
    const attached = firewall.interfaces.map((i) => i.name);
    return { view: "interfaces", ok: true, data: { available: await listInterfaces(), attached } };
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
  async apply(firewall, { sources: [{ name, source }] }) {
    await firewall.enforce(new Policy(name, source));
    return statusOf(firewall, `applied ${name}`);
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

  // A filtered list keeps the numbers of the whole one: `first` is where it starts.
  check: (firewall, { rest, sources }) => {
    const entries = sources.map((source) => checked(firewall, source));
    return {
      view: "catalog",
      ok: entries.every((e) => e.ok),
      data: { entries, active: firewall.policy?.name ?? null, first: Number(rest.split(" ")[1] ?? 1) },
    };
  },
};
