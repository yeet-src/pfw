/* The viewer's line to the firewall worker: ask for what to draw once a
 * second, and hand each answer to `onView`. The port is held here for the
 * life of the isolate; one nothing refers to would be collected.
 */
import { VIEW, WORKER, message } from "#/worker/protocol.js";

const REFRESH_MS = 1000;

export function follow(onView) {
  const { port } = new SharedWorker(WORKER);
  port.onmessage = ({ data }) => {
    if (data?.pfw === VIEW) onView(data);
  };
  port.start();

  const ask = () => port.postMessage(message(VIEW));
  ask();
  setInterval(ask, REFRESH_MS);
  return port;
}
