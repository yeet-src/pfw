/* A policy: pfw-C source with the name it was loaded under, compiled. Pure —
 * it needs no kernel, so it is where a bad policy is refused before the
 * running one is touched.
 */
import { OP, compile } from "pfw-core";

import { parseMeta } from "#/fw/meta.js";
import { keyOf } from "#/fw/name.js";

export class PolicyError extends Error {
  constructor(name, errors) {
    super(`Policy ${name} does not compile: ${errors.map((e) => (e.line ? `line ${e.line}: ` : "") + e.text).join("; ")}`);
    this.name = "PolicyError";
    this.errors = errors;
  }
}

/* Compiling is the slow part of a policy, a few hundred milliseconds for one
 * with large patterns, and what it yields depends on the source alone. `pfw
 * ls` asks for every pulled policy each time it runs, and the sources rarely
 * change between two runs, so each result is kept by its source. Failures
 * are kept too: a policy that does not compile is just as slow to refuse.
 * The oldest go first once there are more than a repository or two's worth.
 */
const KEPT = 512;
const compiledBySource = new Map();

function compileOnce(source) {
  const kept = compiledBySource.get(source);
  if (kept) return kept;
  const compiled = compile(source);
  compiledBySource.set(source, compiled);
  if (compiledBySource.size > KEPT) compiledBySource.delete(compiledBySource.keys().next().value);
  return compiled;
}

// How many sources have been compiled, for a test to see that one was not twice.
export const compiledCount = () => compiledBySource.size;

// The instructions that rewrite the reassembled stream.
const REWRITES = new Set([OP.REDACT, OP.REPLACE]);

export class Policy {
  constructor(name, source) {
    const compiled = compileOnce(source);
    if (!compiled.ok) throw new PolicyError(name, compiled.errors);

    this.name = name;
    this.source = source;
    this.bytes = source.length;
    this.compiled = compiled;
    this.key = keyOf(name);
    this.rules = (compiled.rules ?? []).map((r) => r.name);
    this.meta = parseMeta(source);
    // It reads or rewrites the stream of its connection, reassembled or
    // decoded: there is one a connection, and it is its own policy's.
    this.streams = Boolean(compiled.program.reasm || compiled.program.decode) || compiled.program.ops.some((op) => REWRITES.has(op.code));
    this.knobs = [
      ...(compiled.knobs ?? []).map((knob, slot) => ({ name: knob, kind: "number", default: BigInt(compiled.knobDefaults?.[slot] ?? 0) })),
      ...(compiled.knobStrs ?? []).map((knob) => ({ name: knob, kind: "string", default: "" })),
    ].map((knob) => ({ ...knob, about: this.meta.knobs[knob.name] ?? null }));
  }

  // What status and metrics say about it.
  describe() {
    return { name: this.name, bytes: this.bytes, rules: this.rules, meta: this.meta, streams: this.streams };
  }
}
