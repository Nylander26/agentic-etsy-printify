/**
 * Minimal ANSI color helpers — no dependency.
 *
 * Colors auto-disable when stdout is not a TTY (piped/captured output) or when
 * NO_COLOR / FORCE_COLOR=0 is set, so logs stay clean in non-interactive runs.
 */
const enabled =
  !!process.stdout.isTTY &&
  process.env.NO_COLOR === undefined &&
  process.env.FORCE_COLOR !== "0";

function wrap(open: number, close: number) {
  return (s: string | number): string =>
    enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s);
}

export const colors = {
  enabled,
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

/** Visible length of a string, ignoring ANSI escape codes (for column padding). */
export function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Right-pad to a target VISIBLE width (ANSI-aware). */
export function padVisible(s: string, width: number): string {
  const pad = width - visibleLength(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

/** A 0-10 score rendered as a colored bar: green ≥8, yellow ≥6, dim below. */
export function scoreBar(score: number, max = 10): string {
  const filled = Math.round((Math.max(0, Math.min(max, score)) / max) * 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  const color = score >= 8 ? colors.green : score >= 6 ? colors.yellow : colors.dim;
  return color(bar);
}
