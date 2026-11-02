// End-to-end: real master (next start) + 2 real agents + fake Podman sockets, driven by Chromium.
// Run: npm run build -w apps/master && node --import tsx integration/e2e.mts   (needs `playwright`)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createAgentServer } from "../apps/agent/src/api/server.js";
import { hashToken } from "../apps/agent/src/auth/auth.js";
import { PodmanClient } from "../apps/agent/src/podman/client.js";
import { PodmanService } from "../apps/agent/src/podman/service.js";

const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");
const dir = mkdtempSync(join(tmpdir(), "pm-e2e-"));
const PW = "e2e-admin-password";
const MASTER = "http://127.0.0.1:18081";

interface Host { name: string; state: Map<string, string>; podman: Server; agent: Server; port: number; token: string; sock: string }

async function startHost(name: string, ids: [string, string], port = 0, reuse?: Host): Promise<Host> {
  const sock = reuse?.sock ?? join(dir, `${name}.sock`);
  const state = reuse?.state ?? new Map([[ids[0], "running"], [ids[1], "exited"]]);
  const names: Record<string, string> = { [ids[0]]: `${name}-web`, [ids[1]]: `${name}-db` };
  const send = (res: import("node:http").ServerResponse, s: number, b?: unknown) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(b === undefined ? undefined : JSON.stringify(b)); };
  const item = (id: string) => ({ Id: id, Names: [names[id]], Image: "docker.io/library/nginx", State: state.get(id), Created: "2025-01-01T00:00:00Z", StartedAt: 0 });
  const podman = reuse?.podman ?? createServer((req, res) => {
    const u = req.url ?? "";
    let m: RegExpExecArray | null;
    if (u === "/libpod/_ping") return send(res, 200, "OK");
    if (u === "/libpod/version") return send(res, 200, { Version: "5.2.0", ApiVersion: "5.2.0" });
    if (u === "/libpod/containers/json?all=true") return send(res, 200, ids.map(item));
    if ((m = /^\/libpod\/containers\/([a-f0-9]+)\/json$/.exec(u)) && state.has(m[1]!)) return send(res, 200, { Id: m[1], Name: names[m[1]!], ImageName: "nginx", Created: "2025-01-01T00:00:00Z", State: { Status: state.get(m[1]!) } });
    if ((m = /^\/libpod\/containers\/([a-f0-9]+)\/(start|stop|restart)/.exec(u)) && state.has(m[1]!)) { state.set(m[1]!, m[2] === "stop" ? "exited" : "running"); return send(res, 204); }
    send(res, 404, { message: "no such container" });
  });
  if (!reuse) await new Promise<void>((r) => podman.listen(sock, r));
  const token = reuse?.token ?? randomBytes(24).toString("base64url");
  const agent = createAgentServer(
    { agentId: name, host: "127.0.0.1", port, tokenHash: hashToken(token), podmanSocket: sock, podmanTimeoutMs: 2000, stopTimeoutSec: 10, rateLimitMax: 100, rateLimitWindowMs: 60000 },
    new PodmanService(new PodmanClient(sock, 2000), 10), { info() {}, error() {} },
  );
  await new Promise<void>((r) => agent.listen(port, "127.0.0.1", r));
  return { name, state, podman, agent, port: (agent.address() as AddressInfo).port, token, sock };
}

const stopAgent = (h: Host) => new Promise<void>((r) => { h.agent.closeAllConnections(); h.agent.close(() => r()); });
const id = (c: string) => c.repeat(64);

const h1 = await startHost("host-a", [id("a"), id("b")]);
const h2 = await startHost("host-b", [id("c"), id("d")]);

const master = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", "18081"], {
  cwd: join(import.meta.dirname, "../apps/master"),
  env: { ...process.env, MASTER_SECRET_KEY: randomBytes(32).toString("base64"), DATABASE_URL: `file:${dir}/m.db`, HEARTBEAT_INTERVAL: "5", HEARTBEAT_FAILURES: "2", AGENT_TIMEOUT: "1" },
  stdio: "ignore",
  detached: true,
});
for (let i = 0; i < 40; i++) { try { if ((await fetch(MASTER + "/setup")).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 500)); }

const browser = await chromium.launch();
let failed = false;
const step = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log("ok  -", name); } catch (e) { failed = true; console.log("FAIL -", name, "\n", (e as Error).message); }
};

try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const stat = async (label: string) => Number(await page.locator(".card", { hasText: label }).locator("div").nth(1).innerText());

  await step("unauthenticated access redirects to setup, then admin created", async () => {
    await page.goto(MASTER + "/hosts");
    await page.waitForURL("**/setup");
    await page.fill('input[name="password"]', PW);
    await page.fill('input[name="confirm"]', PW);
    await page.click("form button");
    await page.waitForURL(MASTER + "/");
  });

  await step("register two agents; wrong token / duplicate / bad URL rejected", async () => {
    await page.goto(MASTER + "/hosts");
    const add = async (url: string, token: string) => {
      await page.fill('input[name="url"]', url);
      await page.fill('input[name="token"]', token);
      await page.click("text=Test connection");
    };
    await add(`http://127.0.0.1:${h1.port}`, "wrong-token-0123456789");
    await page.waitForSelector("text=Authentication failed");
    await add("https://127.0.0.1:9126", h1.token);
    await page.waitForSelector("text=Invalid address");
    await add(`http://127.0.0.1:${h1.port}`, h1.token);
    await page.waitForSelector("text=Agent registered");
    await add(`http://127.0.0.1:${h1.port}`, h1.token);
    await page.waitForSelector("text=already registered");
    await add(`http://127.0.0.1:${h2.port}`, h2.token);
    await page.waitForSelector("text=Agent registered");
    await page.reload();
    assert.equal(await page.locator("tbody tr").count(), 2);
    assert.ok(await page.locator("tbody tr", { hasText: "host-a" }).locator("text=online").count());
  });

  await step("dashboard shows aggregated live values", async () => {
    await page.goto(MASTER + "/");
    assert.equal(await stat("Hosts"), 2);
    assert.equal(await stat("Reachable"), 2);
    assert.equal(await stat("Containers"), 4);
    assert.equal(await stat("Running"), 2);
  });

  await step("containers list, filter, stop with confirmation, start", async () => {
    await page.goto(MASTER + "/containers");
    assert.equal(await page.locator("tbody tr").count(), 4);
    await page.goto(MASTER + "/containers?q=host-a-web");
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.click("button:has-text('Stop')");
    await page.waitForSelector("text=Stop “host-a-web”?");
    assert.equal(h1.state.get(id("a")), "running", "must not stop before confirmation");
    await page.click("button:has-text('Confirm')");
    await page.waitForSelector("text=stop succeeded");
    assert.equal(h1.state.get(id("a")), "exited");
    await page.waitForSelector("tbody tr:has-text('host-a-web') >> text=exited");
    await page.click("button:has-text('Start')");
    await page.waitForSelector("text=start succeeded");
    assert.equal(h1.state.get(id("a")), "running");
  });

  await step("detail page works and offers only start/stop/restart", async () => {
    await page.goto(MASTER + "/containers");
    await page.click("a:has-text('host-a-db')");
    await page.waitForSelector("text=Container ID");
    const buttons = (await page.locator("main button").allInnerTexts()).map((t) => t.trim()).sort();
    assert.deepEqual(buttons, ["Restart", "Start", "Stop"]);
  });

  await step("offline agent is flagged separately, others keep working", async () => {
    await stopAgent(h2);
    await page.waitForTimeout(14000);
    await page.goto(MASTER + "/");
    assert.equal(await stat("Unreachable"), 1);
    assert.equal(await stat("Reachable"), 1);
    assert.equal(await stat("Containers"), 2);
    await page.waitForSelector("text=could not be queried");
    await page.goto(MASTER + "/hosts");
    assert.ok(await page.locator("tbody tr", { hasText: "host-b" }).locator("text=offline").count());
    await page.goto(MASTER + "/containers");
    await page.waitForSelector("text=containers unavailable");
  });

  await step("offline agent recovers automatically", async () => {
    const back = await startHost("host-b", [id("c"), id("d")], h2.port, h2);
    h2.agent = back.agent;
    await page.waitForTimeout(8000);
    await page.goto(MASTER + "/");
    assert.equal(await stat("Unreachable"), 0);
    assert.equal(await stat("Reachable"), 2);
  });

  await step("disabled agent gets no operations", async () => {
    await page.goto(MASTER + "/hosts");
    await page.locator("tbody tr", { hasText: "host-a" }).locator("button:has-text('Disable')").click();
    await page.waitForSelector("tbody tr:has-text('host-a') >> text=disabled");
    await page.goto(MASTER + "/containers");
    assert.equal(await page.locator("tbody tr:has-text('host-a')").count(), 0);
  });

  await step("security: logged-out context cannot reach pages; agent rejects unauthenticated calls", async () => {
    const anon = await browser.newContext();
    const p = await anon.newPage();
    await p.goto(MASTER + "/containers");
    assert.match(p.url(), /\/login$/);
    for (const path of ["/api/v1/health", "/api/v1/containers"]) {
      assert.equal((await fetch(`http://127.0.0.1:${h1.port}${path}`)).status, 401);
    }
    assert.equal((await fetch(`http://127.0.0.1:${h1.port}/api/v1/containers/${id("a")}/stop`, { method: "POST" })).status, 401);
    assert.equal(h1.state.get(id("a")), "running");
    await anon.close();
  });
} finally {
  await browser.close();
  try { process.kill(-master.pid!, "SIGTERM"); } catch { /* already gone */ }
  await stopAgent(h1).catch(() => {});
  await stopAgent(h2).catch(() => {});
  h1.podman.close(); h2.podman.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
