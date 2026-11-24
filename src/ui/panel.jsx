/* The app's boxes, after btop: the title sits in the top border, with what
 * the box is saying right now set into the border's far end. The box the
 * keys go to wears the accent.
 */
import { Box, Text } from "yeet:tui";

import { Line, NBSP, tone } from "#/ui/line.jsx";

const CURSOR = tone(54);

/* `title` is a string or runs; `note` runs or a string; `cells` is how wide
 * the box is, when the caller knows. The top edge is drawn here, a row of
 * its own, and the box below wears the other three.
 */
export const Frame = ({ title, note: wanted, cells, lit = false, ...rest }, ...kids) => {
  const edge = tone(lit ? "name" : "frame");
  const runs = (given, role) => (typeof given === "string" ? [[role, given]] : given);
  const length = (given) => runs(given, "").reduce((sum, [, words]) => sum + String(words).length, 0);

  // On a box `cells` wide, the note goes when it and the title cannot both
  // sit in the border with a stretch of rule between them.
  const note = wanted && (cells === undefined || length(title) + length(wanted) + 10 <= cells) ? wanted : null;

  // Titles hold their spaces and never wrap: a border is one row.
  const text = (given, role, bold) => runs(given, role).map(([as, words]) => (
    <Text width="fit" bold={bold} fg={tone(as)} break="none">{String(words).replaceAll(" ", NBSP)}</Text>
  ));

  return (
    <Box {...rest} overflow="hidden">
      <Box height="1" direction="row" overflow="hidden">
        <Text width="fit" fg={edge} break="none">{`╭─${NBSP}`}</Text>
        {text(title, lit ? "strong" : "label", true)}
        <Text width="fit">{NBSP}</Text>
        <Box width="1fr" height="1" overflow="hidden"><Text fg={edge} break="none" overflow="hidden">{"─".repeat(400)}</Text></Box>
        {note ? <Text width="fit">{NBSP}</Text> : null}
        {note ? text(note, "note", false) : null}
        {note ? <Text width="fit">{NBSP}</Text> : null}
        <Text width="fit" fg={edge} break="none">{"─╮"}</Text>
      </Box>
      <Box height="1fr" border={{ line: "round", fg: edge, sides: ["right", "bottom", "left"] }} padding={[0, 1]} overflow="hidden">
        {kids}
      </Box>
    </Box>
  );
};

/* Rows that may not all fit: the `visible` of them from `first`, with a
 * scroll bar down the right when some are out of sight. `at` is the row the
 * cursor is on, if the list has one.
 */
export function Scroll({ rows, visible, first, at }) {
  const shown = rows.slice(first, first + visible);
  if (rows.length <= visible) return shown.map((parts, i) => <Line parts={parts} bg={first + i === at ? CURSOR : undefined} />);

  // The thumb covers the share of the rows on screen, at least a cell.
  const size = Math.max(1, Math.round((visible / rows.length) * visible));
  const top = Math.round((first / (rows.length - visible)) * (visible - size));
  return shown.map((parts, i) => (
    <Box direction="row" height="1">
      <Box width="1fr"><Line parts={parts} bg={first + i === at ? CURSOR : undefined} /></Box>
      <Text width="1" bold fg={tone("label")}>{i >= top && i < top + size ? "┃" : NBSP}</Text>
    </Box>
  ));
}

// Where a window of `visible` rows starts so that it stays inside the list.
export const clamp = (first, total, visible) => Math.max(0, Math.min(first, total - visible));
