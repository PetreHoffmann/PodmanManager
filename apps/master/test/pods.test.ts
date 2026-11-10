import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { fetchAllPods } from "../src/lib/agents";
import { encryptSecret } from "../src/lib/crypto";
import { isPodHidden } from "../src/lib/hidden";

process.env.MASTER_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");

const mk = (id: string, name: string, status: string, names: string[]) => ({
  id: id.repeat(64), name, status, createdAt: null,
  containers: names.map((n, i) => ({ id: String(i + 1).repeat(64), name: n, state: "running", infra: i === 0 })),
});

describe("pods", () => {
  it("a pod is hidden as soon as one container matches; never without patterns", () => {
    const p = mk("a", "stack", "running", ["xyz-infra", "podmanmanager-master"]);
    assert.ok(isPodHidden(p, ["podmanmanager*"]));
    assert.ok(!isPodHidden(p, ["nginx*"]));
    assert.ok(!isPodHidden(p, []));
  });

  describe("live pod lists", () => {
    const list = [mk("a", "stack", "running", ["a-infra", "podmanmanager-agent"]), mk("b", "web", "degraded", ["b-infra", "nginx"])];
    let srv: ReturnType<typeof createServer>;
    const db = openDb(":memory:");
    before(async () => {
      srv = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(req.url === "/api/v1/pods" ? { ok: true, data: list } : { ok: false, error: { code: "NOT_FOUND", message: "x" } }));
      });
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      db.prepare("INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at) VALUES ('a1','h1','127.0.0.1',?, ?, 'now')").run((srv.address() as AddressInfo).port, encryptSecret("tok-0123456789abcdef"));
    });
    after(() => new Promise<void>((r) => srv.close(() => r())));

    it("returns all pods, and drops pods with a hidden container for restricted users", async () => {
      const all = await fetchAllPods(db);
      assert.equal(all[0]!.result.ok && all[0]!.result.data.length, 2);
      const shown = await fetchAllPods(db, null, ["podmanmanager*"]);
      assert.deepEqual(shown[0]!.result.ok && shown[0]!.result.data.map((p) => p.name), ["web"]);
    });
    it("respects the agent scope and reports unreachable agents without throwing", async () => {
      assert.equal((await fetchAllPods(db, new Set([99]))).length, 0);
      db.prepare("UPDATE agents SET port = 1").run();
      const r = await fetchAllPods(db);
      assert.equal(r[0]!.result.ok, false);
    });
  });
});
