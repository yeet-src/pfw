/* Numbers and times as a person reads them. No `Intl` in this runtime. */
const UNITS = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];

// 1234567 -> "1.23M", 4100 -> "4.1k", 312 -> "312"
export function count(value) {
  const n = Number(value ?? 0);
  const unit = UNITS.find(([size]) => n >= size);
  if (!unit) return String(n);
  const scaled = n / unit[0];
  return `${Number(scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2))}${unit[1]}`;
}

const scaled = (n, steps, units) => {
  let i = 0;
  while (i < units.length - 1 && n >= steps) {
    n /= steps;
    i++;
  }
  return `${Number(n.toFixed(n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2))}${units[i]}`;
};

// 4096 -> "4KiB"
export const bytes = (value) => scaled(Number(value ?? 0), 1024, ["B", "KiB", "MiB", "GiB", "TiB"]);

// 412 -> "412ns", 40637 -> "40.6µs"
export const nanos = (value) => scaled(Number(value ?? 0), 1000, ["ns", "µs", "ms", "s"]);

const SPANS = [[86_400_000, "d"], [3_600_000, "h"], [60_000, "m"], [1000, "s"]];

// The two largest units: "3d 4h", "2h 5m", "41s".
export function duration(ms) {
  let rest = Math.max(0, ms);
  const parts = [];
  for (const [size, unit] of SPANS) {
    const whole = Math.floor(rest / size);
    rest -= whole * size;
    if (whole > 0 || (unit === "s" && parts.length === 0)) parts.push(`${whole}${unit}`);
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export { splitName } from "#/fw/name.js";
