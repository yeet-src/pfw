/* The firewall, as a shared worker: it owns the PfwVm, and with it the XDP
 * hook, the policy and the counters, for as long as the keeper holds its
 * port. Every isolate of the service that opens this script reaches the
 * same one:
 *
 *   the keeper (src/main.js)   brings it up, and sends control requests
 *   a scrape (src/scrape.js)   asks for a telemetry snapshot
 */
import { answer } from "#/ctl/reply.js";
import { Firewall } from "#/fw/firewall.js";
import { resolveInterfaces } from "#/fw/interfaces.js";
import { SavedState } from "#/fw/saved.js";
import { document } from "#/metrics/document.js";
import { CTL, FAILED, INIT, READY, REPLY, message } from "#/worker/protocol.js";

/* Comes up as `pfwctl` last left it: on the interfaces it was attached to,
 * enforcing the policy it had. With nothing saved it attaches to the
 * service's `--iface` and passes everything.
 */
async function bringUp({ ifaces, object, base, stateFile }) {
  const state = new SavedState(stateFile);
  const saved = await state.read();

  // A saved interface that has since gone must not keep the firewall down.
  const interfaces = await resolveInterfaces(saved?.interfaces ?? ifaces).catch((error) => {
    console.log(`pfw: saved interfaces were not used: ${error?.message ?? error}`);
    return resolveInterfaces(ifaces);
  });

  const firewall = new Firewall({ interfaces, object, base, knobs: saved?.knobs });
  await firewall.start();
  console.log(`pfw: attached to ${interfaces.map((i) => i.name).join(", ")}`);

  await state.restorePolicy(firewall, saved);
  return { firewall, state };
}

// Brought up once, by the first keeper to ask; a scrape waits on the same promise.
let up = null;
const asked = Promise.withResolvers();

async function snapshot() {
  const { firewall } = await asked.promise.then(() => up);
  return document(firewall.status(), await firewall.stats());
}

const handlers = {
  async [INIT](port, { config }) {
    up ??= bringUp(config);
    asked.resolve();
    try {
      await up;
      port.postMessage(message(READY));
    } catch (error) {
      port.postMessage(message(FAILED, { message: error?.message ?? String(error) }));
    }
  },

  async [CTL](port, { id, request }) {
    const { firewall, state } = await up;
    port.postMessage(message(REPLY, { id, text: await answer(firewall, state, request) }));
  },
};

// `yeet:telemetry`'s snapshot protocol, so a scrape is `render({ worker })`.
async function telemetry(port) {
  try {
    port.postMessage({ __telemetry: "snapshot", doc: await snapshot() });
  } catch (error) {
    port.postMessage({ __telemetry: "error", message: String(error?.message ?? error) });
  }
}

/* Every open port, held. A port nothing refers to is collected, and the
 * host then delivers its messages to a fresh port with no handler: the
 * keeper's commands would vanish once the worker had sat idle.
 */
const ports = new Set();

globalThis.onconnect = (event) => {
  const [port] = event.ports;
  ports.add(port);
  port.addEventListener("close", () => ports.delete(port), { once: true });

  port.onmessage = ({ data }) => {
    if (data?.__telemetry === "snapshot") return telemetry(port);
    return handlers[data?.pfw]?.(port, data);
  };
};
