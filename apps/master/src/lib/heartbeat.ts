import { checkAgent, listAgents } from "./agents";
import { getConfig } from "./config";

const g = globalThis as unknown as { __pmHeartbeat?: NodeJS.Timeout; __pmHbRunning?: boolean };

export async function heartbeatOnce(): Promise<void> {
  if (g.__pmHbRunning) return;
  g.__pmHbRunning = true;
  try {
    const enabled = listAgents().filter((a) => a.enabled);
    await Promise.allSettled(enabled.map((a) => checkAgent(a.id)));
  } finally {
    g.__pmHbRunning = false;
  }
}

export function startHeartbeat(): void {
  if (g.__pmHeartbeat) return;
  const tick = () => {
    heartbeatOnce().catch(() => {});
  };
  g.__pmHeartbeat = setInterval(tick, getConfig().heartbeatIntervalSec * 1000);
  g.__pmHeartbeat.unref();
  tick();
}
