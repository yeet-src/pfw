/* Rows of cells as aligned columns: every column but the last is padded to
 * its widest cell, measured before the color goes on.
 */
export const cell = (paint, text) => ({ paint, text: String(text) });

export function table(rows, indent = "  ") {
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].text.length)));
  return rows.map((r) =>
    `${indent}${r.map((c, col) => c.paint(col === r.length - 1 ? c.text : c.text.padEnd(widths[col]))).join("  ")}`.trimEnd());
}
