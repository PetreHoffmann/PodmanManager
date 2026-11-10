import type { AppLogLine } from "../../../../shared/types/index.js";

const MAX_LINES = 500;
const MAX_TEXT = 1000;
// Defense in depth: tokens/secrets/passwords must never end up in the buffer.
const SECRET = /(bearer\s+)[^\s"']+|((?:token|password|secret|authorization|hash)["']?\s*[=:]\s*)[^\s"',;]+/gi;
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function sanitizeLogText(s: string): string {
  return s.replace(ANSI, "").replace(SECRET, (_m, a?: string, b?: string) => `${a ?? b ?? ""}***`).replace(CTRL, " ").trim().slice(0, MAX_TEXT);
}

const g = globalThis as unknown as { __pmAppLog?: AppLogLine[]; __pmAppLogPatched?: boolean };
const buf = (): AppLogLine[] => (g.__pmAppLog ??= []);

export function pushAppLog(level: AppLogLine["level"], text: string, now: Date = new Date()): void {
  const t = sanitizeLogText(text);
  if (!t) return;
  const b = buf();
  b.push({ ts: now.toISOString(), level, text: t });
  if (b.length > MAX_LINES) b.splice(0, b.length - MAX_LINES);
}

export function appLogTail(n: number): AppLogLine[] {
  return buf().slice(-n);
}

const fmtArg = (a: unknown): string => (a instanceof Error ? a.message : typeof a === "string" ? a : (() => { try { return JSON.stringify(a) ?? String(a); } catch { return String(a); } })());

/** Mirrors console output of the master process into the ring buffer (output itself is unchanged). */
export function captureConsole(): void {
  if (g.__pmAppLogPatched) return;
  g.__pmAppLogPatched = true;
  for (const [fn, level] of [["log", "info"], ["info", "info"], ["warn", "warn"], ["error", "error"]] as const) {
    const orig = console[fn].bind(console);
    console[fn] = (...args: unknown[]) => {
      try {
        pushAppLog(level, args.map(fmtArg).join(" "));
      } catch {
        /* never break logging */
      }
      orig(...args);
    };
  }
}
