import type { LogLine } from "../../../../shared/types/index.js";

export const MAX_LINE_CHARS = 2000;

// ANSI escape sequences (colors, cursor moves) and remaining control characters are not shown.
const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})) ?/;

function clean(text: string): string {
  const t = text.replace(ANSI, "").replace(CTRL, "");
  return t.length > MAX_LINE_CHARS ? `${t.slice(0, MAX_LINE_CHARS)}…` : t;
}

function pushLines(out: LogLine[], payload: string, stream: "stdout" | "stderr"): void {
  if (payload === "") return;
  const parts = payload.split(/\r?\n/);
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop(); // trailing newline
  for (const raw of parts) {
    const m = TS.exec(raw);
    out.push({ ts: m ? m[1]! : null, stream, text: clean(m ? raw.slice(m[0].length) : raw) });
  }
}

/**
 * Podman returns container logs as a multiplexed stream: frames of an 8-byte header
 * (stream type 0/1/2, three zero bytes, big-endian payload length) followed by the payload
 * (verified with Podman 4.9.3, also for containers with a TTY). Anything that does not look
 * like frames is treated as plain text. Only the last `tail` lines are returned.
 */
export function parseLogStream(buf: Buffer, tail: number): LogLine[] {
  const out: LogLine[] = [];
  let i = 0;
  const isHeader = (at: number) => at + 8 <= buf.length && buf[at]! <= 2 && buf[at + 1] === 0 && buf[at + 2] === 0 && buf[at + 3] === 0;
  if (!isHeader(0)) {
    pushLines(out, buf.toString("utf8"), "stdout");
  } else {
    while (isHeader(i)) {
      const len = buf.readUInt32BE(i + 4);
      const end = i + 8 + len;
      if (end > buf.length) break;
      pushLines(out, buf.toString("utf8", i + 8, end), buf[i] === 2 ? "stderr" : "stdout");
      i = end;
    }
    if (i < buf.length && !isHeader(i)) pushLines(out, buf.toString("utf8", i), "stdout");
  }
  return out.slice(-tail);
}
