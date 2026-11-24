/* A row of the screen as colored runs: `[[role, text], ...]`. The roles are
 * the reply palette's (src/ctl/render/palette.js), so the app and the text
 * replies wear the same colors, with two of the app's own: `frame` for
 * borders and the track of a meter, and a bare number for a color of the
 * 256, which is how a gradient is drawn.
 */
import { Box, Text, idx } from "yeet:tui";

export const COLORS = { ok: 46, bad: 196, warn: 226, label: 135, value: 208, name: 199, note: 214, strong: 231, tag: 39, frame: 60 };
const BOLD = new Set(["ok", "bad", "warn", "strong", "name", "tag"]);

// A plain space at a run's edge is trimmed away; this one is kept.
export const NBSP = " ";

export const tone = (role) => idx(typeof role === "number" ? role : COLORS[role]);

// A run wears the row's tint too: a face of its own would show the terminal's
// background through the cursor.
const Run = (bg) => ([role, text]) =>
  (role === "" ? <Text bg={bg}>{text}</Text> : <Text fg={tone(role)} bold={BOLD.has(role)} bg={bg}>{text}</Text>);

// `bg` tints the whole row, edge to edge: the one the cursor is on.
export const Line = ({ parts, bg }) => (
  <Box height="1" bg={bg}>
    <Text height="1" break="none" overflow="hidden" bg={bg}>{parts.map(Run(bg))}</Text>
  </Box>
);

export const lines = (rows) => rows.map((parts) => <Line parts={parts} />);

// Rows of `[role, text]` cells as aligned columns: every column but the
// last is padded to its widest cell.
export function columns(rows, gap = "  ") {
  if (rows.length === 0) return [];
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col][1]).length)));
  return rows.map((r) =>
    r.flatMap(([role, text], col) => [[role, col === r.length - 1 ? String(text) : String(text).padEnd(widths[col])], ["", gap]]));
}
