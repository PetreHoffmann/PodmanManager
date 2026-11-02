export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getSecretKey } = await import("./lib/config");
    getSecretKey(); // fail fast on bad MASTER_SECRET_KEY
    const { startHeartbeat } = await import("./lib/heartbeat");
    startHeartbeat();
  }
}
