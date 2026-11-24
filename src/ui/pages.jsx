/* The app's pages: each a full dashboard, after btop, about one thing.
 *
 *   overview   traffic, with a little of everything under it
 *   rules      what is being stopped, and by which rule
 *   timing     what deciding costs
 *   engine     the VM's own counters, and what it is working through
 *
 * A page takes the latest view, the room it has, and where its cursor is;
 * one with a box that scrolls says how many places that cursor has, and one
 * that reads clicks says what they mean.
 */
import { Box } from "yeet:tui";

import { Line, lines } from "#/ui/line.jsx";
import { Frame, Scroll, clamp } from "#/ui/panel.jsx";
import {
  counters, graph, graphNote, ruleDetail, ruleTable, rulesOf, slowest, speeds, timing, timingFacts, unmatched,
  verdicts,
} from "#/ui/views.js";

const within = (n, low, high) => Math.max(low, Math.min(high, n));

// A box's inner columns: its width less the frame and the padding.
const inner = (cells) => cells - 4;

const NO_RULES = [["note", "no policy is enforcing, so there are no rules"]];
const RULES = 1;
// In a box holding a list: the border, then the list's heading.
const LIST_TOP = 2;

const spanOf = (view) => (view.speeds ? `last ${view.window}s` : "measuring");

// One of the speeds as a graph in a box, its numbers in the border.
const Graph = ({ view, speed, title = speed, cells, rows, ...rest }) => (
  <Frame title={title} note={graphNote(view, speed)} cells={cells} height={String(rows)} {...rest}>
    {lines(graph(view, speed, inner(cells), rows - 2))}
  </Frame>
);

/* ---- overview ---- */

function overviewRoom({ cols, rows }, view) {
  const top = within(Math.round(rows * 0.34), 7, 16);
  const below = rows - top;
  const left = within(Math.round(cols * 0.36), 30, 46);
  const moving = Object.values(view.speeds ?? {}).filter((s) => s.peak > 0).length;
  const speed = within(Math.max(1, moving) + 2, 3, Math.max(3, below - 4));
  // The heading goes with the list.
  const rules = within(rulesOf(view).length + 3, 4, Math.max(4, Math.round(below * 0.5)));
  return { top, below, left, right: cols - left, speed, rules, side: within(Math.round(cols * 0.3), 28, 38) };
}

function Overview(view, screen) {
  const room = overviewRoom(screen, view);
  const { cols } = screen;
  const list = rulesOf(view);
  const table = ruleTable(view, list, inner(room.right) - 1);
  const time = timing(view, inner(room.left));

  return [
    <Frame title="traffic" note={graphNote(view, "packets")} cells={cols} height={String(room.top)}>
      <Box direction="row" height="1fr">
        <Box width="1fr">{lines(graph(view, "packets", Math.max(8, cols - room.side - 5), room.top - 2))}</Box>
        <Box width="1" />
        <Box width={String(room.side)}>{lines(verdicts(view, room.side))}</Box>
      </Box>
    </Frame>,
    <Box direction="row" height="1fr">
      <Box width={String(room.left)}>
        <Frame title="speed" note={spanOf(view)} cells={room.left} height={String(room.speed)}>
          {lines(speeds(view, inner(room.left)))}
        </Frame>
        <Frame title="decision time" note={time.note} cells={room.left} height="1fr">{lines(time.rows)}</Frame>
      </Box>
      <Box width="1fr">
        <Frame title="busiest rules" note={list.length > 0 ? `${list.length} in all` : "none"} cells={room.right} height={String(room.rules)}>
          {list.length === 0 ? <Line parts={NO_RULES} /> : [<Line parts={table.head} />, ...lines(table.rows)]}
        </Frame>
        <Frame title="engine" note="what the VM counted" cells={room.right} height="1fr">
          {lines(counters(view, inner(room.right)))}
        </Frame>
      </Box>
    </Box>,
  ];
}

// A busiest rule, clicked, opens the rules page on it.
function openRule(view, screen, _at, x, y) {
  const room = overviewRoom(screen, view);
  const row = y - room.top - LIST_TOP;
  return x >= room.left && row >= 0 && row < Math.min(rulesOf(view).length, room.rules - 3) ? { page: RULES, place: row } : null;
}

/* ---- rules ---- */

function rulesRoom({ cols, rows }) {
  const top = within(Math.round(rows * 0.3), 6, 12);
  const side = within(Math.round(cols * 0.3), 28, 40);
  return { top, side, list: cols - side, visible: Math.max(1, rows - top - 2 - 1) };
}

function Rules(view, screen, at) {
  const room = rulesRoom(screen);
  const { cols } = screen;
  const list = rulesOf(view);
  const table = ruleTable(view, list, inner(room.list) - 1);
  const picked = list[at];

  return [
    <Box direction="row" height={String(room.top)}>
      <Graph view={view} speed="blocked" cells={room.list} rows={room.top} width="1fr" />
      <Frame title="verdicts" cells={room.side} width={String(room.side)}>{lines(verdicts(view, inner(room.side)))}</Frame>
    </Box>,
    <Box direction="row" height="1fr">
      <Frame title="rules" note={list.length > 0 ? `${at + 1} of ${list.length} · by hits` : "none"} lit cells={room.list} width="1fr">
        {list.length === 0 ? <Line parts={NO_RULES} /> : [
          <Line parts={table.head} />,
          <Scroll rows={table.rows} visible={room.visible} first={clamp(at - Math.floor(room.visible / 2), list.length, room.visible)} at={at} />,
        ]}
      </Frame>
      <Box width={String(room.side)}>
        <Frame title={picked ? picked.name : "rule"} note="picked" cells={room.side} height="11">
          {picked ? lines(ruleDetail(view, picked, inner(room.side))) : <Line parts={[["note", "none to pick"]]} />}
        </Frame>
        <Frame title="clean passes" cells={room.side} height="1fr">
          {lines([unmatched(view).slice(2), [["note", "packets no rule stopped"]]])}
        </Frame>
      </Box>
    </Box>,
  ];
}

function pickRule(view, screen, at, x, y) {
  const room = rulesRoom(screen);
  const total = rulesOf(view).length;
  const first = clamp(at - Math.floor(room.visible / 2), total, room.visible);
  const row = y - room.top - LIST_TOP;
  return x < room.list && row >= 0 && row < Math.min(room.visible, total) ? { place: first + row } : null;
}

/* ---- timing ---- */

function timingRoom({ cols, rows }) {
  const bottom = within(Math.round(rows * 0.3), 5, 10);
  const side = within(Math.round(cols * 0.34), 30, 44);
  return { bottom, side, main: cols - side, visible: Math.max(1, rows - bottom - 2) };
}

function Timing(view, screen, at) {
  const room = timingRoom(screen);
  const time = timing(view, inner(room.main) - 1, { summary: false });

  return [
    <Box direction="row" height="1fr">
      <Frame title="decision time" note={time.note} lit cells={room.main} width="1fr">
        <Scroll rows={time.rows} visible={room.visible} first={clamp(at, time.rows.length, room.visible)} />
      </Frame>
      <Box width={String(room.side)}>
        <Frame title="in numbers" cells={room.side} height="10">{lines(timingFacts(view))}</Frame>
        <Frame title="slowest" note="mean time" cells={room.side} height="1fr">{lines(slowest(view, inner(room.side)))}</Frame>
      </Box>
    </Box>,
    <Graph view={view} speed="scanned" title="payload scanned" cells={screen.cols} rows={room.bottom} />,
  ];
}

const timingPlaces = (view, screen) => {
  const room = timingRoom(screen);
  return Math.max(1, timing(view, inner(room.main) - 1, { summary: false }).rows.length - room.visible + 1);
};

/* ---- engine ---- */

function engineRoom({ cols, rows }) {
  const top = within(Math.round(rows * 0.3), 5, 11);
  return { top, half: Math.floor(cols / 2), visible: Math.max(1, rows - top - 2) };
}

function Engine(view, screen, at) {
  const room = engineRoom(screen);
  const { cols } = screen;
  const counted = counters(view, inner(cols) - 1);

  return [
    <Box direction="row" height={String(room.top)}>
      <Graph view={view} speed="flows" title="new flows" cells={room.half} rows={room.top} width={String(room.half)} />
      <Graph view={view} speed="scanned" title="payload scanned" cells={cols - room.half} rows={room.top} width="1fr" />
    </Box>,
    <Frame title="engine" note="every counter the VM keeps" lit cells={cols} height="1fr">
      <Scroll rows={counted} visible={room.visible} first={clamp(at, counted.length, room.visible)} />
    </Frame>,
  ];
}

const enginePlaces = (view, screen) =>
  Math.max(1, counters(view, inner(screen.cols) - 1).length - engineRoom(screen).visible + 1);

export const PAGES = [
  { name: "overview", render: Overview, click: openRule },
  { name: "rules", render: Rules, places: (view) => rulesOf(view).length, click: pickRule },
  { name: "timing", render: Timing, places: timingPlaces },
  { name: "engine", render: Engine, places: enginePlaces },
];
