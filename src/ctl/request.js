/* A control request as it travels: a header line, and for `apply` and
 * `check` the policy sources after it, each counted in bytes because
 * `yeet dial` forwards a pipe in whatever chunks it read.
 *
 *   [@<format> ]<verb> [<rest>]
 *   apply [confirm=<time> ][at=<place> ]<bytes> <name>\n<bytes of pfw-C>
 *   clear [at=<place>]
 *   check <count> [<filter>...]\n  then <count> of  <bytes> <name>\n<bytes of pfw-C>
 *   knobs <0|1>, knob-set <0|1> <knob> <value>, knob-unset <0|1> <knob>
 *                    then, for 1, the one policy they are about
 *
 * Read whole here, in the keeper, so the worker is handed plain data.
 */
export const FORMATS = ["json", "tty", "plain"];

// The VM's budgets keep a compiled policy small; source far past them is a mistake.
const MAX_POLICY_BYTES = 1024 * 1024;
const MAX_CHECKED = 1024;
const MAX_HEADER_BYTES = 4096;

// `confirm=<time> ` ahead of a command's arguments puts the change on trial.
const CONFIRM = /^confirm=(\S+)(?: |$)/;
export const confirmOf = (rest) => rest.match(CONFIRM)?.[1] ?? null;

// `at=<place> `, after it, says where: the spec of src/fw/place.js.
const AT = /^at=(\S+)(?: |$)/;
export const atOf = (rest) => rest.replace(CONFIRM, "").match(AT)?.[1] ?? null;

export function parseHeader(line) {
  const [, format = "json", verb = "", rest = ""] = line.trim().match(/^(?:@(\S+) )?(\S*)(?: (.*))?$/s) ?? [];
  if (!FORMATS.includes(format)) throw new Error(`Unknown format: ${format} (${FORMATS.join(", ")})`);
  return { format, verb, rest };
}

// One `<bytes> <name>` header and the source it counts.
async function readSource(header, stream) {
  const [, size, name] = header.match(/^(\d+) (.+)$/) ?? [];
  if (!name) throw new Error("Expected `<bytes> <name>` before a policy's source");
  const bytes = Number(size);
  if (bytes > MAX_POLICY_BYTES) throw new Error(`Policy ${name} is ${bytes} bytes, over the ${MAX_POLICY_BYTES} limit`);
  return { name, source: await stream.text(bytes) };
}

// `<0|1> ...`: the policy the command is about, when it names one.
async function optionalSource(rest, stream) {
  const [, given] = rest.match(/^([01])(?: |$)/) ?? [];
  if (!given) throw new Error("Expected 0 or 1 policies");
  return given === "1" ? [await readSource(await stream.line(MAX_HEADER_BYTES), stream)] : [];
}

const SOURCES = {
  apply: async (rest, stream) => [await readSource(rest.replace(CONFIRM, "").replace(AT, ""), stream)],

  // `<count> [<filter>...]`: the count of sources, then what to show of them.
  async check(rest, stream) {
    const [count] = rest.split(" ");
    if (!/^\d+$/.test(count) || Number(count) > MAX_CHECKED) throw new Error(`Usage: check <count> [<filter>...], at most ${MAX_CHECKED}`);

    const sources = [];
    for (let i = 0; i < Number(count); i++) sources.push(await readSource(await stream.line(MAX_HEADER_BYTES), stream));
    return sources;
  },

  knobs: optionalSource,
  "knob-set": optionalSource,
  "knob-unset": optionalSource,
};

// The header first, so a request that fails later is still refused in its format.
export async function readHeader(stream) {
  return parseHeader(await stream.line(MAX_HEADER_BYTES));
}

export async function readSources({ verb, rest }, stream) {
  return Object.hasOwn(SOURCES, verb) ? SOURCES[verb](rest, stream) : [];
}
