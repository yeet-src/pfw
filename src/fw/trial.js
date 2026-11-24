/* A change on trial: made now, and undone at a deadline unless it is
 * confirmed first. The way out for a policy that cuts off the person who
 * applied it: they need do nothing, and it goes back by itself.
 *
 * A trial remembers what the firewall was doing before its first change.
 * Changes made while it is pending are part of it, and a second trial only
 * moves the deadline: what it goes back to is still the last state anyone
 * confirmed.
 */
const UNITS = { s: 1000, m: 60_000, h: 3_600_000 };
const SHORTEST = 5000;
const LONGEST = 24 * UNITS.h;

// "90s", "10m", "1h" as milliseconds.
export function parseSpan(text) {
  const [, amount, unit] = String(text).match(/^(\d+)([smh])$/) ?? [];
  if (!unit) throw new Error(`A time is a number and s, m or h, like 10m: ${text} is not one`);
  const ms = Number(amount) * UNITS[unit];
  if (ms < SHORTEST || ms > LONGEST) throw new Error(`A trial lasts between 5s and 24h: ${text} does not`);
  return ms;
}

export class Trial {
  #before = null;
  #until = null;
  #timer = null;
  #expire;

  // `expire(before)` is called at the deadline with what to go back to.
  constructor(expire) {
    this.#expire = expire;
  }

  get pending() {
    return this.#until !== null;
  }

  get until() {
    return this.#until;
  }

  // What the firewall goes back to, while one is pending.
  get before() {
    return this.#before;
  }

  begin(before, ms, now = Date.now()) {
    this.#before ??= before;
    this.#until = now + ms;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#expire(this.end()), ms);
  }

  // Ends the trial and returns what it would have gone back to, or null.
  end() {
    const before = this.#before;
    clearTimeout(this.#timer);
    this.#before = null;
    this.#until = null;
    this.#timer = null;
    return before;
  }
}
