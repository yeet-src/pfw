/* The keeper's end of the firewall worker: the port that holds the worker
 * alive, and the control requests sent down it.
 *
 * The host stops a shared worker with its last connection, and a scrape
 * isolate lives for milliseconds, so this port is what keeps the firewall,
 * and the XDP hook inside it, up between requests.
 */
import { CTL, FAILED, INIT, READY, REPLY, WORKER, message } from "#/worker/protocol.js";

// Moving interfaces reloads the VM, which is the slowest thing asked of it:
// the kernel takes two seconds over the engine on one machine and twenty on
// another.
const ANSWER_TIMEOUT_MS = 90_000;

export class FirewallLink {
  #port;
  #waiting = new Map();
  #nextId = 1;

  constructor(port) {
    this.#port = port;
    port.onmessage = ({ data }) => {
      if (data?.pfw !== REPLY) return;
      this.#waiting.get(data.id)?.(data.text);
      this.#waiting.delete(data.id);
    };
  }

  /* Open the worker and have it bring the firewall up as `config` says.
   * Rejects with the worker's reason when it cannot, which fails this
   * isolate's start, and so the service's.
   */
  static async open(config) {
    const worker = new SharedWorker(WORKER);
    const port = worker.port;

    await new Promise((resolve, reject) => {
      worker.addEventListener("error", (e) => reject(new Error(e.message ?? "The firewall worker failed to load")), { once: true });
      port.onmessage = ({ data }) => {
        if (data?.pfw === READY) resolve();
        if (data?.pfw === FAILED) reject(new Error(data.message));
      };
      port.start();
      port.postMessage(message(INIT, { config }));
    });

    return new FirewallLink(port);
  }

  /* One control request, answered with the text of its reply. A worker
   * that has gone quiet rejects it, so a peer is refused, never left waiting.
   */
  ask(request) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id);
        reject(new Error(`The firewall did not answer in ${ANSWER_TIMEOUT_MS / 1000}s`));
      }, ANSWER_TIMEOUT_MS);

      this.#waiting.set(id, (text) => {
        clearTimeout(timer);
        resolve(text);
      });
      this.#port.postMessage(message(CTL, { id, request }));
    });
  }
}
