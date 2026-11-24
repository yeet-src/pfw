/* The `ctl` portal, served by the keeper: every peer sends one command and
 * gets one reply, then is closed. The command is read whole here and run in
 * the firewall worker; `bin/pfw` is the client, over `yeet dial`.
 */
import { refusal } from "#/ctl/render/refusal.js";
import { readHeader, readSources } from "#/ctl/request.js";
import { ByteStream } from "#/ctl/stream.js";

export const CTL_PORTAL = "ctl";

const encoder = new TextEncoder();

async function exchange(firewall, peer) {
  const stream = new ByteStream(peer);
  let format = "json";
  try {
    const header = await readHeader(stream);
    format = header.format;
    return await firewall.ask({ ...header, sources: await readSources(header, stream) });
  } catch (error) {
    return refusal(format, error);
  }
}

export function serveCtl(firewall) {
  const portal = new Portal(CTL_PORTAL);

  portal.on("peer", async (peer) => {
    const text = await exchange(firewall, peer);

    // `yeet dial` prints binary frames as output; text frames are console lines.
    if (!peer.closed) peer.write(encoder.encode(`${text}\n`));
    peer.close();
  });

  return portal;
}
