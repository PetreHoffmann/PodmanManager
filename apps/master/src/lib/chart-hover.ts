import { fmtBytes } from "../components/ui";

export type ChartUnit = "percent" | "bytes" | "rate";

/** Index of the measuring point closest to time `t` (times ascending); -1 for an empty series. */
export function nearestIndex(times: number[], t: number): number {
  if (times.length === 0) return -1;
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid; else hi = mid;
  }
  return Math.abs(times[lo]! - t) <= Math.abs(times[hi]! - t) ? lo : hi;
}

export function fmtUnit(v: number | null, unit: ChartUnit, lang: string): string {
  if (v === null) return "–";
  if (unit === "percent") return `${v.toFixed(v < 10 ? 1 : 0)} %`;
  return unit === "rate" ? `${fmtBytes(v, lang)}/s` : fmtBytes(v, lang);
}

/** Clock time as HH:MM in the viewer's time zone. */
export function fmtClock(ms: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
