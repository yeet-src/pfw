/* A portal peer read as a byte stream. `yeet dial` forwards a pipe in
 * whatever chunks it read, so message boundaries mean nothing: a command is
 * framed by its header line and a byte count instead.
 */
const NEWLINE = 0x0a;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesOf = (data) => (typeof data === "string" ? encoder.encode(data) : new Uint8Array(data));

export class ByteStream {
  #peer;
  #held = new Uint8Array(0);

  constructor(peer) {
    this.#peer = peer;
  }

  async #more() {
    const chunk = bytesOf(await this.#peer.recv());
    const joined = new Uint8Array(this.#held.length + chunk.length);
    joined.set(this.#held);
    joined.set(chunk, this.#held.length);
    this.#held = joined;
  }

  #take(n) {
    const taken = this.#held.subarray(0, n);
    this.#held = this.#held.subarray(n);
    return taken;
  }

  // The next line without its newline; rejects once it exceeds `limit` bytes.
  async line(limit) {
    for (;;) {
      const end = this.#held.indexOf(NEWLINE);
      if (end >= 0 && end <= limit) {
        const text = decoder.decode(this.#take(end));
        this.#take(1);
        return text;
      }
      if (end > limit || this.#held.length > limit) throw new Error(`Line is longer than ${limit} bytes`);
      await this.#more();
    }
  }

  async exact(n) {
    while (this.#held.length < n) await this.#more();
    return this.#take(n);
  }

  async text(n) {
    return decoder.decode(await this.exact(n));
  }
}
