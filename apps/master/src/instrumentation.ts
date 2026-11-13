export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { captureConsole, pushAppLog } = await import("./lib/applog");
    captureConsole();
    pushAppLog("info", "master started");
    const { getSecretKey } = await import("./lib/config");
    getSecretKey(); // fail fast on bad MASTER_SECRET_KEY
    const { ensureLocalHost } = await import("./lib/agents");
    ensureLocalHost(); // the master's own host (LOCAL_PODMAN_SOCKET)
    const { startAuditPrune } = await import("./lib/audit");
    startAuditPrune();
    const { startAutoBackup } = await import("./lib/autobackup");
    startAutoBackup();
    const { startHeartbeat } = await import("./lib/heartbeat");
    startHeartbeat();
  }
}
