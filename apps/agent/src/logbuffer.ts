import type { AppLogLine } from "../../../shared/types/index.js";

const MAX_TEXT = 1000;
// Defense in depth: tokens/secrets must never end up in the buffer.
const SECRET = /(bearer\s+)[^\s"']+|((?:token|password|secret|authorization|hash)["']?\s*[=:]\s*)[^\s"',;]+/gi;
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/g;

export function sanitizeLogText(s: string): string {
  return s.replace(SECRET, (_m, a: string | undefined, b: string | undefined) => `${a ?? b ?? ""}***`).replace(CTRL, " ").slice(0, MAX_TEXT);
}

/** In-memory ring buffer of the agent's own log lines. */
export class LogBuffer {
  private lines: AppLogLine[] = [];
  constructor(private readonly max = 500) {}

  push(level: AppLogLine["level"], text: string, now: Date = new Date()): void {
    this.lines.push({ ts: now.toISOString(), level, text: sanitizeLogText(text) });
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }

  tail(n: number): AppLogLine[] {
    return this.lines.slice(-n);
  }
}
