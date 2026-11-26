import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createAgentServer } from "../../agent/src/api/server.js";
import { realisticPodman } from "../../agent/test/helpers.js";
import { PodmanClient } from "../../agent/src/podman/client.js";
import { PodmanService } from "../../agent/src/podman/service.js";
import { agentSetupFor, checkAgent, createPendingAgent, getAgent, rotateAgentToken, targetFor, updateAgentAddress } from "../src/lib/agents";
import { agentSetup, hashAgentToken, newAgentToken } from "../src/lib/agent-setup";
import { openDb } from "../src/database/db";

process.env.MASTER_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");

describe("agent setup blocks", () => {
  it("generates token and SHA-256 hash like the agent does", () => {
    const { token, hash } = newAgentToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hash, hashAgentToken(token));
    assert.match(hash, /^[a-f0-9]{64}$/);
  });
  it("fills the Quadlet file; binds the IP only for an IPv4 address", () => {
    const hash = "a".repeat(64);
    const ip = agentSetup("host-1", "192.168.1.21", hash);
    assert.match(ip.quadlet, /^PublishPort=192\.168\.1\.21:9126:9126$/m);
    assert.match(ip.quadlet, /^Environment=AGENT_ID=host-1$/m);
    assert.match(ip.quadlet, new RegExp(`^Environment=AGENT_TOKEN_HASH=${hash}$`, "m"));
    assert.equal(ip.hashLine, `AGENT_TOKEN_HASH=${hash}`);
    assert.match(agentSetup("h", "box.lan", hash).quadlet, /^PublishPort=9126:9126$/m);
  });
});

describe("host created before its agent exists", () => {
  let dir: string, sock: string, podmanSrv: ReturnType<typeof createServer>, agentSrv: ReturnType<typeof createAgentServer>, port: number;
  const db = openDb(":memory:");
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "pm-w-"));
    sock = join(dir, "p.sock");
    podmanSrv = createServer(realisticPodman((req, res) => {
      const u = req.url ?? "";
      res.writeHead(u === "/libpod/version" || u === "/libpod/_ping" ? 200 : 404, { "Content-Type": "application/json" });
      res.end(u === "/libpod/version" ? JSON.stringify({ Version: "5.2.0", ApiVersion: "5.2.0" }) : u === "/libpod/_ping" ? "OK" : "{}");
    }));
    await new Promise<void>((r) => podmanSrv.listen(sock, r));
    agentSrv = createAgentServer(
      { agentId: "host-1", host: "127.0.0.1", port: 0, tokenHash: "0".repeat(64), podmanSocket: sock, podmanTimeoutMs: 2000, stopTimeoutSec: 10, rateLimitMax: 100, rateLimitWindowMs: 60000 },
      new PodmanService(new PodmanClient(sock, 2000), 10), { info() {}, error() {} },
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

  it("creates the host with a stored token and returns only the hash", () => {
    const r = createPendingAgent("http://192.168.1.21:9126", " host-1 ", db);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const row = getAgent(r.data.id, db)!;
    assert.equal(row.agent_id, "host-1");
    assert.equal(row.status, "unknown");
    const tok = targetFor(r.data.id, db)!.token;
    assert.equal(hashAgentToken(tok), r.data.setup.hash);
    assert.equal(JSON.stringify(r.data.setup).includes(tok), false);
    assert.equal(agentSetupFor(r.data.id, db)?.hash, r.data.setup.hash);
  });

  it("rejects bad input and duplicates", () => {
    assert.deepEqual(createPendingAgent("https://x:1", "a", db), { ok: false, error: "err.invalidAddress" });
    assert.deepEqual(createPendingAgent("http://10.0.0.1:9126", "bad id!", db), { ok: false, error: "err.invalidAgentId" });
    assert.deepEqual(createPendingAgent("http://192.168.1.21:9126", "other", db), { ok: false, error: "err.alreadyRegistered" });
    assert.deepEqual(createPendingAgent("http://10.0.0.1:9126", "host-1", db), { ok: false, error: "err.agentIdTaken", params: { id: "host-1" } });
  });

  it("goes online once an agent with that hash runs, and loses the connection after a token renewal", async () => {
    const r = createPendingAgent(`http://127.0.0.1:${port}`, "host-2", db);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const withHash = createAgentServer(
      { agentId: "host-2", host: "127.0.0.1", port: 0, tokenHash: r.data.setup.hash, podmanSocket: sock, podmanTimeoutMs: 2000, stopTimeoutSec: 10, rateLimitMax: 100, rateLimitWindowMs: 60000 },
      new PodmanService(new PodmanClient(sock, 2000), 10), { info() {}, error() {} },
    );
    await new Promise<void>((ok) => withHash.listen(0, "127.0.0.1", ok));
    const p2 = (withHash.address() as AddressInfo).port;
    db.prepare("UPDATE agents SET port = ? WHERE id = ?").run(p2, r.data.id);
    try {
      assert.equal((await checkAgent(r.data.id, db))?.status, "online");
      const renewed = rotateAgentToken(r.data.id, db)!;
      assert.notEqual(renewed.hash, r.data.setup.hash);
      const after = await checkAgent(r.data.id, db);
      assert.equal(after?.fail_count, 1);
      assert.match(after?.last_error ?? "", /UNAUTHORIZED/);
    } finally {
      withHash.closeAllConnections();
      await new Promise((ok) => withHash.close(ok));
    }
  });
});

describe("changing the address of a host", () => {
  const db = openDb(":memory:");
  it("keeps token and hash, resets the state, rebuilds the Quadlet block", () => {
    const a = createPendingAgent("http://10.0.0.1:9126", "host-a", db);
    const b = createPendingAgent("http://10.0.0.2:9126", "host-b", db);
    assert.equal(a.ok && b.ok, true);
    if (!a.ok || !b.ok) return;
    const tokenBefore = targetFor(a.data.id, db)!.token;
    db.prepare("UPDATE agents SET status = 'offline', fail_count = 5, last_error = 'x' WHERE id = ?").run(a.data.id);
    const r = updateAgentAddress(a.data.id, "http://10.0.0.9:9200", db);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.old, "10.0.0.1:9126");
    assert.equal(r.data.address, "10.0.0.9:9200");
    assert.equal(r.data.setup.hash, a.data.setup.hash);
    assert.match(r.data.setup.quadlet, /^PublishPort=10\.0\.0\.9:9126:9126$/m);
    const row = getAgent(a.data.id, db)!;
    assert.deepEqual([row.address, row.port, row.status, row.fail_count, row.last_error], ["10.0.0.9", 9200, "unknown", 0, null]);
    assert.equal(targetFor(a.data.id, db)!.token, tokenBefore);
    assert.equal(getAgent(b.data.id, db)!.address, "10.0.0.2");
  });
  it("rejects bad input, an address of another host and the local host", () => {
    const [x, y] = db.prepare("SELECT id FROM agents ORDER BY id").all() as { id: number }[];
    assert.deepEqual(updateAgentAddress(x!.id, "https://x:1", db), { ok: false, error: "err.invalidAddress" });
    assert.deepEqual(updateAgentAddress(x!.id, "http://10.0.0.2:9126", db), { ok: false, error: "err.alreadyRegistered" });
    assert.equal(updateAgentAddress(x!.id, "http://10.0.0.9:9200", db).ok, true); // its own address again is fine
    assert.deepEqual(updateAgentAddress(99999, "http://10.0.0.5:9126", db), { ok: false, error: "msg.invalidAgent" });
    db.prepare("INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at, kind) VALUES ('local','local','local',0,'',?, 'local')").run(new Date().toISOString());
    const loc = db.prepare("SELECT id FROM agents WHERE kind = 'local'").get() as { id: number };
    assert.deepEqual(updateAgentAddress(loc.id, "http://10.0.0.5:9126", db), { ok: false, error: "msg.invalidAgent" });
    assert.ok(y);
  });
});
