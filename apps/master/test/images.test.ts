import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { agentImageDelete, agentImagePrune } from "../src/lib/agent-client";
import { fetchAllImages } from "../src/lib/agents";
import { encryptSecret } from "../src/lib/crypto";
import { makeT, type Lang } from "../src/lib/i18n";

process.env.MASTER_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");

const img = { id: "a".repeat(64), tags: ["docker.io/x/app:latest"], size: 10, createdAt: null, containers: 0, dangling: false, protected: false };

describe("images", () => {
  const seen: string[] = [];
  let srv: ReturnType<typeof createServer>;
  const db = openDb(":memory:");
  let target: { address: string; port: number; token: string };
  before(async () => {
    srv = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      const u = req.url ?? "";
      res.end(JSON.stringify({ ok: true, data: u === "/api/v1/images" ? [img] : u.endsWith("/prune") ? { removed: 2, reclaimed: 5 } : { result: "untagged" } }));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as AddressInfo).port;
    target = { address: "127.0.0.1", port, token: "tok-0123456789abcdef" };
    db.prepare("INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at) VALUES ('a1','h1','127.0.0.1',?, ?, 'now')").run(port, encryptSecret(target.token));
  });
  after(() => new Promise<void>((r) => srv.close(() => r())));

  it("lists images per host and respects the agent scope", async () => {
    const all = await fetchAllImages(db);
    assert.equal(all[0]!.result.ok && all[0]!.result.data[0]!.id, img.id);
    assert.equal((await fetchAllImages(db, new Set([99]))).length, 0);
  });

  it("delete sends DELETE with the encoded tag, and refuses invalid ids without calling the agent", async () => {
    seen.length = 0;
    const r = await agentImageDelete(target, img.id, "docker.io/x/app:1.0");
    assert.ok(r.ok && r.data.result === "untagged");
    assert.equal(seen[0], `DELETE /api/v1/images/${img.id}?tag=docker.io%2Fx%2Fapp%3A1.0 Bearer ${target.token}`);
    seen.length = 0;
    const bad = await agentImageDelete(target, "../etc", null);
    assert.equal(bad.ok, false);
    assert.equal(seen.length, 0);
  });

  it("prune posts and returns counts", async () => {
    const r = await agentImagePrune(target);
    assert.ok(r.ok && r.data.removed === 2);
  });

  it("all languages have the image texts", () => {
    for (const lang of ["en", "de", "ro", "es"] as Lang[]) {
      for (const k of ["nav.images", "images.title", "images.deleteQ", "images.pruned", "errc.IMAGE_IN_USE", "errc.IMAGE_PROTECTED"] as const) {
        assert.notEqual(makeT(lang)(k), k, `${lang} ${k}`);
      }
    }
  });
});
