export interface UpdateStatus { state: "pulling" | "restarting" | "current" | "error" | "idle"; message?: string }
export interface UpdateOutcome { kind: "restarting" | "current" | "error" | "timeout"; message?: string }

/**
 * Follows the self-update of an agent after it was started. The agent answers with its state: "pulling" while the image is
 * loaded, then "restarting" (it exits and systemd starts it from the new image), "current" (image unchanged) or "error".
 * A restarted agent has forgotten its state ("idle") or does not answer for a moment (null): both mean the restart happened.
 */
export async function pollUpdate(
  status: () => Promise<UpdateStatus | null>,
  opts: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<UpdateOutcome> {
  const interval = opts.intervalMs ?? 3000;
  const timeout = opts.timeoutMs ?? 120_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const t0 = now();
  let sawPulling = false;
  for (;;) {
    let s: UpdateStatus | null = null;
    try {
      s = await status();
    } catch {
      s = null;
    }
    if (s?.state === "error") return { kind: "error", message: s.message };
    if (s?.state === "current") return { kind: "current" };
    if (s?.state === "restarting") return { kind: "restarting" };
    if (s?.state === "pulling") sawPulling = true;
    else if (sawPulling || s?.state === "idle") return { kind: "restarting" }; // gone or restarted already
    if (now() - t0 >= timeout) return { kind: "timeout" };
    await sleep(interval);
  }
}
