import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createAgentServer } from "../../agent/src/api/server.js";
import { hashToken } from "../../agent/src/auth/auth.js";
import { PodmanClient } from "../../agent/src/podman/client.js";
import { PodmanService } from "../../agent/src/podman/service.js";
import { agentAction, agentList } from "../src/lib/agent-client";
import { checkAgent, fetchAllContainers, getAgent, listAgents, registerAgent, removeAgent, setEnabled, targetFor } from "../src/lib/agents";
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from "../src/lib/crypto";
import { openDb } from "../src/database/db";
import { parseAgentUrl } from "../src/lib/validate";

process.env.MASTER_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.AGENT_TIMEOUT = "1";
process.env.HEARTBEAT_FAILURES = "2";

const TOKEN = "master-test-token-0123456789";
const ID = "a".repeat(64);

describe("crypto & validation", () => {
  it("encrypts round-trip and detects tampering", () => {
    const k = Buffer.alloc(32, 1);
    const blob = encryptSecret("secret", k);
    assert.ok(!blob.includes("secret"));
    assert.equal(decryptSecret(blob, k), "secret");
    assert.throws(() => decryptSecret(blob.slice(0, -2) + "AA", k));
  });
  it("hashes passwords", async () => {
    const h = await hashPassword("correct horse");
    assert.equal(await verifyPassword("correct horse", h), true);
    assert.equal(await verifyPassword("wrong", h), false);
  });
  it("parses only plain http host:port", () => {
    assert.deepEqual(parseAgentUrl("http://192.168.1.21:9126"), { address: "192.168.1.21", port: 9126 });
    assert.deepEqual(parseAgentUrl("http://Host.lan/"), { address: "host.lan", port: 9126 });
    for (const bad of ["https://a:1", "http://a:1/x", "http://u:p@a:1", "http://a:99999", "ftp://a", "http://", "a:9126"]) {
      assert.equal(parseAgentUrl(bad), null, bad);
    }
  });
});

describe("master with real agent over HTTP", () => {
  let dir: string, sock: string, podmanSrv: ReturnType<typeof createServer>, agentSrv: ReturnType<typeof createAgentServer>, port: number;
  let running = true;
  const db = openDb(":memory:");

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "pm-m-"));
    sock = join(dir, "p.sock");
    podmanSrv = createServer((req, res) => {
      const u = req.url ?? "";
      const send = (s: number, b?: unknown) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(b === undefined ? undefined : JSON.stringify(b)); };
      if (u === "/libpod/_ping") return send(200, "OK");
      if (u === "/libpod/version") return send(200, { Version: "5.2.0", ApiVersion: "5.2.0" });
      if (u === "/libpod/containers/json?all=true") return send(200, [{ Id: ID, Names: ["web"], Image: "nginx", State: running ? "running" : "exited", Created: "2025-01-01T00:00:00Z", StartedAt: 0 }]);
      if (u === `/libpod/containers/${ID}/json`) return send(200, { Id: ID, Name: "web", ImageName: "nginx", Created: "2025-01-01T00:00:00Z", State: { Status: running ? "running" : "exited" } });
      if (u === `/libpod/containers/${ID}/stop?timeout=10`) { running = false; return send(204); }
      send(404, { message: "nope" });
    });
    await new Promise<void>((r) => podmanSrv.listen(sock, r));
    const svc = new PodmanService(new PodmanClient(sock, 2000), 10);
    agentSrv = createAgentServer(
      { agentId: "agent-1", host: "127.0.0.1", port: 0, tokenHash: hashToken(TOKEN), podmanSocket: sock, podmanTimeoutMs: 2000, stopTimeoutSec: 10, rateLimitMax: 100, rateLimitWindowMs: 60000 },
      svc, { info() {}, error() {} },
    );
    await new Promise<void>((r) => agentSrv.listen(0, "127.0.0.1", r));
    port = (agentSrv.address() as AddressInfo).port;
  });
  after(async () => {
    agentSrv.closeAllConnections();
    await new Promise((r) => agentSrv.close(r));
    await new Promise((r) => podmanSrv.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects wrong token and unreachable address on register", async () => {
    const bad = await registerAgent(`http://127.0.0.1:${port}`, "wrong-token-0123456789", db);
    assert.equal(bad.ok, false);
    assert.equal((bad as { error: string }).error, "err.authFailed");
    const none = await registerAgent("http://127.0.0.1:1", TOKEN, db);
    assert.equal(none.ok, false);
    assert.equal(listAgents(db).length, 0);
  });

  let id = 0;
  it("registers once, stores token encrypted, blocks duplicates", async () => {
    const r = await registerAgent(`http://127.0.0.1:${port}`, TOKEN, db);
    assert.equal(r.ok, true);
    id = (r as { data: number }).data;
    const raw = db.prepare("SELECT token_enc FROM agents WHERE id = ?").get(id) as { token_enc: string };
    assert.ok(!raw.token_enc.includes(TOKEN));
    assert.equal(targetFor(id, db)?.token, TOKEN);
    const a = getAgent(id, db)!;
    assert.equal(a.agent_id, "agent-1");
    assert.equal(a.podman_version, "5.2.0");
    assert.equal(a.status, "online");
    const dup = await registerAgent(`http://127.0.0.1:${port}`, TOKEN, db);
    assert.equal(dup.ok, false);
  });

  it("lists containers and runs stop through the agent", async () => {
    const all = await fetchAllContainers(db);
    assert.equal(all[0]!.result.ok && all[0]!.result.data[0]!.state, "running");
    const r = await agentAction(targetFor(id, db)!, ID, "stop");
    assert.equal(r.ok && r.data.container.state, "exited");
    const bad = await agentAction(targetFor(id, db)!, "../x", "stop");
    assert.equal(bad.ok, false);
  });

  it("disabled agents are not queried", async () => {
    setEnabled(id, false, db);
    const all = await fetchAllContainers(db);
    assert.equal(all[0]!.result.ok, false);
    setEnabled(id, true, db);
  });

  it("marks agent offline after N failures and recovers", async () => {
    const t = targetFor(id, db)!;
    assert.equal((await checkAgent(id, db))!.status, "online");
    db.prepare("UPDATE agents SET port = 1 WHERE id = ?").run(id);
    assert.equal((await checkAgent(id, db))!.status, "online");
    const off = (await checkAgent(id, db))!;
    assert.equal(off.status, "offline");
    assert.equal(off.fail_count, 2);
    assert.ok(off.last_error);
    const list = await agentList({ ...t, port: 1 });
    assert.equal(list.ok, false);
    db.prepare("UPDATE agents SET port = ? WHERE id = ?").run(port, id);
    const back = (await checkAgent(id, db))!;
    assert.equal(back.status, "online");
    assert.equal(back.fail_count, 0);
  });

  it("removes agents", () => {
    removeAgent(id, db);
    assert.equal(getAgent(id, db), null);
  });
});
