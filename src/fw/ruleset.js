/* Every policy in place, and where each is: the default, the routes and the
 * chain run first. A value: a change makes a new one, so the one before is
 * still whole to go back to, and two can be compared for what to do to the
 * kernel to get from one to the other.
 */
import { DEFAULT, FIRST, routePlace } from "#/fw/place.js";

// What pfw-core runs at once: 64 programs, at most 8 of them in the chain.
const MAX_FIRST = 8;
const MAX_PROGRAMS = 64;

export class Ruleset {
  static EMPTY = new Ruleset();

  #default;
  // route spec -> { route, policy }
  #routes;
  #first;

  constructor({ policy = null, routes = new Map(), first = [] } = {}) {
    this.#default = policy;
    this.#routes = routes;
    this.#first = first;
  }

  get default() {
    return this.#default;
  }

  get first() {
    return this.#first;
  }

  get routes() {
    return [...this.#routes.values()];
  }

  get empty() {
    return this.entries().length === 0;
  }

  /* Every policy with its place, as status lists them. `at` is the name its
   * counts and events go under: `default`, `first` and `first.1` on down
   * the chain, or the route's label.
   */
  entries() {
    return [
      ...(this.#default ? [{ at: DEFAULT.label, place: DEFAULT, policy: this.#default }] : []),
      ...this.#first.map((policy, i) => ({ at: i === 0 ? FIRST.label : `${FIRST.label}.${i}`, place: FIRST, policy })),
      ...this.routes.map(({ route, policy }) => ({ at: route.label, place: routePlace(route), policy })),
    ];
  }

  // What is at `place`: a policy or null, and for the chain a list.
  at(place) {
    if (place.kind === DEFAULT.kind) return this.#default;
    if (place.kind === FIRST.kind) return this.#first;
    return this.#routes.get(place.spec)?.policy ?? null;
  }

  // This with `value` at `place`, in the form `at` returns it.
  put(place, value) {
    const next = { policy: this.#default, routes: this.#routes, first: this.#first };

    if (place.kind === DEFAULT.kind) next.policy = value;
    else if (place.kind === FIRST.kind) next.first = [...value];
    else {
      next.routes = new Map(this.#routes);
      if (value) next.routes.set(place.spec, { route: place.route, policy: value });
      else next.routes.delete(place.spec);
    }

    return new Ruleset(next).#checked();
  }

  #checked() {
    if (this.#first.length > MAX_FIRST) throw new Error(`At most ${MAX_FIRST} policies run first: there are ${this.#first.length}`);
    const count = this.entries().length;
    if (count > MAX_PROGRAMS) throw new Error(`At most ${MAX_PROGRAMS} policies are in place at once: that makes ${count}`);
    return this;
  }

  /* This with `policy` applied at `place`. The default and a route hold one
   * policy, which it replaces. The chain holds several: a policy already in
   * it is replaced where it stands, and a new one goes on the end.
   */
  with(place, policy) {
    if (place.kind !== FIRST.kind) return this.put(place, policy);

    if (policy.streams) throw new Error(`${policy.name} reads a reassembled or decoded stream, which a policy run first does not have: give it a route, or make it the default`);
    const standing = this.#first.findIndex((p) => p.key === policy.key);
    return this.put(FIRST, standing < 0 ? [...this.#first, policy] : this.#first.with(standing, policy));
  }

  // This with nothing at `place`, which must hold something.
  without(place) {
    const there = this.at(place);
    if (!there || there.length === 0) throw new Error(`No policy is in place at ${place.label}`);
    return this.put(place, place.kind === FIRST.kind ? [] : null);
  }

  /* The steps from `from` to this, each `[place, value]` for `put`: the
   * routes that go, the default, the routes that come or change, then the
   * chain, which is swapped whole.
   */
  changesFrom(from) {
    const gone = from.routes.filter(({ route }) => !this.#routes.has(route.spec)).map(({ route }) => [routePlace(route), null]);
    const come = this.routes.filter(({ route, policy }) => from.#routes.get(route.spec)?.policy !== policy).map(({ route, policy }) => [routePlace(route), policy]);
    const chained = this.#first.length !== from.#first.length || this.#first.some((policy, i) => policy !== from.#first[i]);

    return [
      ...gone,
      ...(this.#default !== from.#default ? [[DEFAULT, this.#default]] : []),
      ...come,
      ...(chained ? [[FIRST, this.#first]] : []),
    ];
  }
}
