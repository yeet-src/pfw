/* The colors a rendered reply uses, by what the text is and never by hue,
 * so a view cannot drift from the palette. The five of a bag of Skittles
 * (red, orange, yellow, green, purple) and the pink of the berry ones, with
 * blue for tags, on the 256-color cube; nothing is dimmed, so it reads on any background.
 * Off, every role is the identity and the text is plain.
 */
const ROLES = {
  ok: 46,
  bad: 196,
  warn: 226,
  label: 135,
  value: 208,
  name: 199,
  note: 214,
  strong: 231,
  tag: 39,
};

const BOLD = new Set(["ok", "bad", "warn", "strong", "name", "tag"]);

const sgr = (color, bold) => (text) => `\x1b[${bold ? "1;" : ""}38;5;${color}m${text}\x1b[0m`;

export const palette = (colored) =>
  Object.fromEntries(Object.keys(ROLES).map((role) => [role, colored ? sgr(ROLES[role], BOLD.has(role)) : String]));
