/* One scrape: a per-connection isolate behind the /metrics route, whose
 * console output is the response body. The spec names the worker the
 * keeper holds, so it renders the running firewall's counters.
 */
import { render } from "yeet:telemetry";

import { WORKER } from "#/worker/protocol.js";

console.log(await render({ worker: WORKER }));
