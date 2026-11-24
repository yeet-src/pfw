/* A command's result as the text of its reply. A result names its view;
 * the view renders the result's data in the palette the client asked for.
 */
import { catalog } from "#/ctl/render/catalog.js";
import { interfaces } from "#/ctl/render/interfaces.js";
import { knobs } from "#/ctl/render/knobs.js";
import { metrics } from "#/ctl/render/metrics.js";
import { palette } from "#/ctl/render/palette.js";
import { status } from "#/ctl/render/status.js";

// The path on a line of its own, then the module, for `pfw` to write there.
const saved = ({ path, module }) => `${path}\n${module}`;

const VIEWS = { status, catalog, interfaces, knobs, metrics, saved };

export function render({ view, data, notice }, format) {
  const p = palette(format === "tty");
  const body = VIEWS[view](data, p);
  return notice ? `${p.ok("✔")} ${p.strong(notice)}\n${body}` : body;
}
