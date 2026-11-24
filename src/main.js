/* The keeper: the service's one eager isolate. It opens the firewall worker
 * and holds its port, which keeps the firewall up, and it serves the `ctl`
 * portal, passing each command down that port.
 *
 *   yeet run dist -- --iface eth0            one interface, by name or ifindex
 *   yeet run dist -- --iface eth0,eth1       several
 *
 * It does not park: evaluation has to finish for the service to leave
 * "starting", and the open port and portal keep this isolate alive.
 */
import { config } from "#/config.js";
import { serveCtl } from "#/ctl/portal.js";
import { FirewallLink } from "#/worker/link.js";

const firewall = await FirewallLink.open(config(yeet.args, import.meta.dirname));

serveCtl(firewall);
