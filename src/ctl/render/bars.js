/* Numbers as shapes: a bar for a share of something, a sparkline for a
 * history. Plain strings, so the text replies and the terminal app draw
 * them the same.
 */
const EIGHTHS = " ▏▎▍▌▋▊▉█";
const SPARKS = "▁▂▃▄▅▆▇█";

// `fraction` of `width` cells, to an eighth of a cell.
export function bar(fraction, width = 24) {
  const eighths = Math.round(Math.min(1, Math.max(0, fraction)) * width * 8);
  const partial = eighths % 8;
  return "█".repeat(Math.floor(eighths / 8)) + (partial ? EIGHTHS[partial] : "");
}

// The last `width` values, each against the tallest of them; empty when none moved.
export function sparkline(history, width = 30) {
  const recent = history.slice(-width);
  const tallest = Math.max(...recent);
  if (!(tallest > 0)) return "";
  return recent.map((v) => (v <= 0 ? " " : SPARKS[Math.min(7, Math.floor((v / tallest) * 7.99))])).join("");
}

export const percent = (part, whole) =>
  (whole > 0 ? `${((part / whole) * 100).toFixed(part > 0 && part / whole < 0.001 ? 2 : 1)}%` : "");

/* A history as a column chart `height` rows tall, newest on the right: one
 * string a row, top first. Each column rises to its share of the tallest,
 * to an eighth of a row, so a quiet second still shows as a sliver.
 */
export function chart(history, width, height) {
  const recent = history.slice(-width);
  const tallest = Math.max(0, ...recent);
  const levels = recent.map((v) => (tallest > 0 && v > 0 ? Math.max(1, Math.round((v / tallest) * height * 8)) : 0));
  const lead = " ".repeat(Math.max(0, width - recent.length));

  return Array.from({ length: height }, (_, row) => {
    const floor = (height - 1 - row) * 8;
    return lead + levels.map((level) => (level >= floor + 8 ? "█" : level > floor ? SPARKS[level - floor - 1] : " ")).join("");
  });
}

/* A history fitted to exactly `width` columns, so a graph fills its box
 * whatever the two sizes are: with more columns than samples each sample
 * is drawn several columns wide, and with fewer each column is the tallest
 * of the samples it stands for, so a spike is never averaged away.
 */
export function resample(history, width) {
  if (history.length === 0 || width <= 0) return [];
  return Array.from({ length: width }, (_, col) => {
    const from = Math.floor((col * history.length) / width);
    const to = Math.max(from + 1, Math.floor(((col + 1) * history.length) / width));
    return Math.max(...history.slice(from, to));
  });
}
