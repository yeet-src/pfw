/* A request that was refused, as the text of its reply. On its own so the
 * keeper can refuse a malformed request without the firewall's commands.
 */
import { palette } from "#/ctl/render/palette.js";

// Counters are BigInt, which JSON has no spelling for.
export const json = (value) => JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v));

export function renderError(error, format) {
  const p = palette(format === "tty");
  return `${p.bad("✘")} ${p.strong(error?.message ?? String(error))}`;
}

export const refusal = (format, error) =>
  format === "json"
    ? json({ ok: false, error: error?.message ?? String(error), errors: error?.errors })
    : `err\n${renderError(error, format)}`;
