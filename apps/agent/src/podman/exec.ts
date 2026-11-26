/**
 * Running one command in a container (no shell session, no stdin, no TTY). The request is small and strictly
 * validated: the command is a list of arguments (never a shell string), the time and the output are limited.
 */
export interface ExecRequest {
  cmd: string[];
  timeoutSec: number;
}
export interface ExecResult {
  /** null if the command did not finish (time limit) */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** the output was cut at the size limit */
  truncated: boolean;
  timedOut: boolean;
}
export type ParsedExec = { ok: true; req: ExecRequest } | { ok: false; message: string };

export const EXEC_MAX_ARGS = 20;
export const EXEC_MAX_ARG_LENGTH = 1024;
export const EXEC_DEFAULT_TIMEOUT = 15;
export const EXEC_MAX_TIMEOUT = 60;
/** per stream, in bytes */
export const EXEC_MAX_OUTPUT = 64 * 1024;

export function parseExecRequest(input: unknown): ParsedExec {
  const fail = (message: string): ParsedExec => ({ ok: false, message });
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("Request body must be an object");
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "cmd" && k !== "timeoutSec") return fail(`Unknown field "${k.slice(0, 40)}"`);
  if (!Array.isArray(o.cmd) || o.cmd.length < 1 || o.cmd.length > EXEC_MAX_ARGS) return fail(`The command needs 1 to ${EXEC_MAX_ARGS} arguments`);
  const cmd: string[] = [];
  for (const a of o.cmd) {
    if (typeof a !== "string" || a.length > EXEC_MAX_ARG_LENGTH || a.includes("\0")) return fail("Invalid command argument");
    cmd.push(a);
  }
  if (cmd[0] === "") return fail("The program name is empty");
  let timeoutSec = EXEC_DEFAULT_TIMEOUT;
  if (o.timeoutSec !== undefined && o.timeoutSec !== null) {
    if (typeof o.timeoutSec !== "number" || !Number.isInteger(o.timeoutSec) || o.timeoutSec < 1 || o.timeoutSec > EXEC_MAX_TIMEOUT) return fail(`The time limit must be 1 to ${EXEC_MAX_TIMEOUT} seconds`);
    timeoutSec = o.timeoutSec;
  }
  return { ok: true, req: { cmd, timeoutSec } };
}

/** Splits the multiplexed exec stream (8-byte frame header: stream 1/2, three zero bytes, length) into stdout and stderr. */
export function demux(buf: Buffer): { stdout: Buffer; stderr: Buffer } {
  const out: Buffer[] = [], err: Buffer[] = [];
  for (let i = 0; i + 8 <= buf.length; ) {
    const type = buf[i]!;
    const len = buf.readUInt32BE(i + 4);
    const part = buf.subarray(i + 8, Math.min(buf.length, i + 8 + len));
    if (type === 1) out.push(part);
    else if (type === 2) err.push(part);
    i += 8 + len;
  }
  return { stdout: Buffer.concat(out), stderr: Buffer.concat(err) };
}

/** UTF-8 text of at most `max` bytes; the second value tells whether anything was cut. */
export function clip(b: Buffer, max: number): [string, boolean] {
  if (b.length <= max) return [b.toString("utf8"), false];
  return [b.subarray(0, max).toString("utf8").replace(/�$/, ""), true];
}
