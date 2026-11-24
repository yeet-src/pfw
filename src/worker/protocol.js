/* What crosses the port between the firewall worker and the isolates that
 * reach it. Scrapes speak `yeet:telemetry`'s snapshot protocol, so
 * `render({ worker })` works unchanged; these are the keeper's own.
 */
export const WORKER = "./firewall.js";

export const INIT = "init";
export const READY = "ready";
export const FAILED = "failed";
export const CTL = "ctl";
export const REPLY = "reply";

export const message = (kind, fields = {}) => ({ pfw: kind, ...fields });
