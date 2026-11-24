/* The metrics app: a terminal application each viewer gets an isolate of,
 * reached with `yeet dial` on the service's /ui route (`pfw metrics`
 * does it). It draws what the firewall worker sends once a second.
 *
 *   1-4, tab, ← →     the page; a click on its tab
 *   ↑ ↓, j k, wheel   the rule picked on the rules page, a row scrolled elsewhere;
 *                     a click on a rule picks it
 *   pgup pgdn, g G    a screenful, the ends
 *   q, esc            leave
 */
import { Box, Text, mount, signal } from "yeet:tui";

import { follow } from "#/ui/feed.js";
import { NBSP, tone } from "#/ui/line.jsx";
import { PAGES } from "#/ui/pages.jsx";
import { status, totals } from "#/ui/views.js";

const view = signal(null);
const page = signal(0);
// Where each page's cursor is: the rule picked, or the rows scrolled.
const places = signal(PAGES.map(() => 0));

follow((next) => view.set(next));

// A page's room: the status takes a row, the tabs two, the keys one.
const screen = () => {
  const { rows, cols } = tty.size();
  return { cols, rows: rows - 4 };
};

// How many places the showing page's cursor has, as things now stand.
function reach() {
  const latest = view.get();
  const count = PAGES[page.get()].places;
  return latest && count ? Math.max(1, count(latest, screen())) : 1;
}

const placeOf = (index) => Math.min(places.get()[index], Math.max(0, reach() - 1));

function move(by) {
  const index = page.get();
  setPlace(index, Math.max(0, Math.min(reach() - 1, placeOf(index) + by)));
}

const turn = (by) => page.set((page.get() + by + PAGES.length) % PAGES.length);

const PAGE_KEYS = { PageDown: 10, PageUp: -10, End: Infinity, Home: -Infinity };

const TAB_GAP = 4;
const tabText = (name, i) => `${i + 1} ${name}`;

// Rows above a page: the status, then the tabs' names and their rule.
const TABS_ROW = 1;
const PAGE_TOP = 3;

// The tab whose name, or the rule under it, is at column `x`.
function tabAt(x) {
  let from = 1;
  for (const [i, { name }] of PAGES.entries()) {
    const to = from + tabText(name, i).length;
    if (x >= from - 1 && x < to + 1) return i;
    from = to + TAB_GAP;
  }
  return -1;
}

const setPlace = (index, place) => places.set(places.get().map((was, i) => (i === index ? place : was)));

/* A click on a tab shows its page; a click in a page is the page's to read:
 * a rule picked, or a busiest rule followed to the rules page.
 */
function click({ clientX: x, clientY: y }) {
  if (y === TABS_ROW || y === TABS_ROW + 1) {
    const tab = tabAt(x);
    if (tab >= 0) page.set(tab);
    return;
  }

  const latest = view.get();
  const index = page.get();
  const hit = latest && PAGES[index].click?.(latest, screen(), placeOf(index), x, y - PAGE_TOP);
  if (!hit) return;
  const target = hit.page ?? index;
  setPlace(target, hit.place);
  page.set(target);
}

tty.enableMouse();
tty.on("wheel", (e) => move(e.deltaY > 0 ? 3 : -3));
tty.on("mousedown", (e) => {
  if (e.button === 0) click(e);
});
tty.on("keydown", (e) => {
  const key = e.key ?? e.code;
  if (key === "q" || e.code === "Escape") return yeet.exit();
  if (/^[1-9]$/.test(key) && Number(key) <= PAGES.length) return page.set(Number(key) - 1);
  if (e.code === "ArrowRight" || e.code === "Tab" || key === "l") return turn(1);
  if (e.code === "ArrowLeft" || key === "h") return turn(-1);
  if (e.code === "ArrowDown" || key === "j") return move(1);
  if (e.code === "ArrowUp" || key === "k") return move(-1);
  if (e.code in PAGE_KEYS) return move(PAGE_KEYS[e.code]);
  if (key === " ") return move(10);
  if (key === "g") return move(-Infinity);
  if (key === "G") return move(Infinity);
});

/* Is it up, where, enforcing what: a bar the width of the screen, above
 * everything, with the totals at its far end. The stretch between the two
 * takes up whatever the screen has, so the bar is always as wide as the
 * boxes under it.
 */
const BAR = tone(236);

const runsOn = (runs) => runs.map(([role, text]) => (role === ""
  ? <Text width="fit" bg={BAR}>{text}</Text>
  : <Text width="fit" bold={role !== "note" && role !== "frame"} fg={tone(role)} bg={BAR} break="none">{text}</Text>));

const Status = () => {
  const latest = view.get();
  const left = latest ? status(latest, Date.now()) : [["strong", "pfw"], ["", NBSP], ["note", "connecting to the firewall…"]];
  // The totals are there while the bar has room for both ends and a gap.
  const size = (runs) => runs.reduce((cells, [, text]) => cells + text.length, 0);
  const right = latest ? totals(latest) : null;
  const far = right && size(left) + size(right) + 6 <= tty.size().cols ? right : null;

  return (
    <Box height="1" direction="row" overflow="hidden" bg={BAR}>
      <Text width="fit" bg={BAR}>{NBSP}</Text>
      {runsOn(left)}
      <Box width="1fr" height="1" bg={BAR} />
      {far ? runsOn(far) : null}
      <Text width="fit" bg={BAR}>{NBSP}</Text>
    </Box>
  );
};

/* The pages as a row of names over a rule: the rule runs the width of the
 * screen, and thickens and takes the accent under the page showing. The
 * digit before a name is its key.
 */
const Tabs = () => {
  const showing = page.get();
  const before = PAGES.slice(0, showing).reduce((cells, { name }, i) => cells + tabText(name, i).length + TAB_GAP, 1);
  const under = tabText(PAGES[showing].name, showing).length;

  return (
    <Box height="2">
      <Box height="1" direction="row">
        <Text width="fit">{NBSP}</Text>
        {PAGES.flatMap(({ name }, i) => {
          const lit = i === showing;
          return [
            <Text width="fit" bold fg={tone(lit ? "name" : "frame")}>{`${i + 1}${NBSP}`}</Text>,
            <Text width="fit" bold={lit} fg={tone(lit ? "strong" : "label")}>{name}</Text>,
            <Text width="fit">{NBSP.repeat(TAB_GAP)}</Text>,
          ];
        })}
      </Box>
      <Box height="1" direction="row" overflow="hidden">
        <Text width="fit" fg={tone("frame")}>{"─".repeat(before)}</Text>
        <Text width="fit" bold fg={tone("name")}>{"━".repeat(under)}</Text>
        <Box width="1fr" height="1" overflow="hidden"><Text fg={tone("frame")} break="none">{"─".repeat(400)}</Text></Box>
      </Box>
    </Box>
  );
};

const KEYS = [["1-4", "page"], ["←→", "next"], ["↑↓", "move"], ["pgup pgdn", "faster"], ["click", "tab or rule"], ["q", "quit"]];

const Keys = () => (
  <Box height="1" direction="row">
    {KEYS.flatMap(([key, does]) => [
      <Text width="fit" bold fg={tone("name")}>{`${NBSP}${key}${NBSP}`}</Text>,
      <Text width="fit" fg={tone("frame")}>{`${does}${NBSP}${NBSP}`}</Text>,
    ])}
  </Box>
);

const Root = (size) => (
  <Box>
    {Status}
    {Tabs}
    <Box height="1fr" overflow="hidden">
      {() => {
        const latest = view.get();
        if (!latest) return null;
        size.get();
        places.get();
        const index = page.get();
        return PAGES[index].render(latest, screen(), placeOf(index));
      }}
    </Box>
    <Keys />
  </Box>
);

mount(Root);
await new Promise(() => {});
