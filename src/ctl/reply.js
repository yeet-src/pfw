/* A control request's reply, as text in the format it asked for:
 *
 *   json (default)   one line, `{ ok, ...data }` or `{ ok: false, error }`
 *   tty, plain       `ok` or `err` on a line of its own, then the rendered
 *                    text, colored for `tty`
 */
import { commands } from "#/ctl/commands.js";
import { render } from "#/ctl/render/index.js";
import { json, refusal } from "#/ctl/render/refusal.js";

const accepted = (format, result) =>
  format === "json"
    ? json({ ok: result.ok, ...result.data })
    : `${result.ok ? "ok" : "err"}\n${render(result, format)}`;

// Run `request` against the firewall. Never throws: a failure is a reply too.
export async function answer(firewall, state, request) {
  try {
    const command = Object.hasOwn(commands, request.verb) ? commands[request.verb] : null;
    if (!command) throw new Error(`Unknown command: ${request.verb || "(empty)"}`);
    return accepted(request.format, await command(firewall, request, state));
  } catch (error) {
    return refusal(request.format, error);
  }
}
