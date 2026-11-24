/* A policy: pfw-C source with the name it was loaded under, compiled. Pure —
 * it needs no kernel, so it is where a bad policy is refused before the
 * running one is touched.
 */
import { compile } from "pfw-core";

import { parseMeta } from "#/fw/meta.js";
import { keyOf } from "#/fw/name.js";

export class PolicyError extends Error {
  constructor(name, errors) {
    super(`Policy ${name} does not compile: ${errors.map((e) => (e.line ? `line ${e.line}: ` : "") + e.text).join("; ")}`);
    this.name = "PolicyError";
    this.errors = errors;
  }
}

export class Policy {
  constructor(name, source) {
    const compiled = compile(source);
    if (!compiled.ok) throw new PolicyError(name, compiled.errors);

    this.name = name;
    this.source = source;
    this.bytes = source.length;
    this.compiled = compiled;
    this.key = keyOf(name);
    this.rules = (compiled.rules ?? []).map((r) => r.name);
    this.meta = parseMeta(source);
    this.knobs = [
      ...(compiled.knobs ?? []).map((knob, slot) => ({ name: knob, kind: "number", default: BigInt(compiled.knobDefaults?.[slot] ?? 0) })),
      ...(compiled.knobStrs ?? []).map((knob) => ({ name: knob, kind: "string", default: "" })),
    ].map((knob) => ({ ...knob, about: this.meta.knobs[knob.name] ?? null }));
  }

  // What status and metrics say about it.
  describe() {
    return { name: this.name, bytes: this.bytes, rules: this.rules, meta: this.meta };
  }
}
