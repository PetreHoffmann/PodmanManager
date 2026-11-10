import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { fetchAllContainers } from "../src/lib/agents";
import { encryptSecret } from "../src/lib/crypto";
import { globToRegExp, hiddenPatternsFor, isHidden, loadHiddenPatterns, parsePatterns, saveHiddenPatterns } from "../src/lib/hidden";
import type { SessionInfo } from "../src/lib/session-types";

process.env.MASTER_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");

describe("hidden container patterns", () => {
  it("matches with * and ?, case-insensitive, anchored; everything else is literal", () => {
    assert.ok(isHidden("podmanmanager-agent", ["podmanmanager*"]));
    assert.ok(isHidden("PodmanManager-Master", ["podmanmanager*"]));
    assert.ok(isHidden("web-db", ["*-db"]));
    assert.ok(!isHidden("web-db-old", ["*-db"]));
    assert.ok(isHidden("app1", ["app?"]));
    assert.ok(!isHidden("app12", ["app?"]));
    assert.ok(!isHidden("my-podmanmanager", ["podmanmanager*"]), "anchored at the start");
    assert.ok(isHidden("a.b", ["a.b"]));
    assert.ok(!isHidden("axb", ["a.b"]), "dot is literal, not a regex wildcard");
    assert.ok(!isHidden("anything", []));
    assert.equal(globToRegExp("a+b").test("aab"), false);
  });

  it("parses lines, ignores blanks/comments/duplicates and lowercases", () => {
    assert.deepEqual(parsePatterns("PodmanManager*\n\n# internal\n*-secret\r\npodmanmanager*\n"), { ok: true, patterns: ["podmanmanager*", "*-secret"] });
    assert.deepEqual(parsePatterns(""), { ok: true, patterns: [] });
  });

  it("rejects characters outside the container-name alphabet and too many patterns", () => {
    for (const bad of ["a b", "a/b", "(x)", "a|b", "[a]", "a\\b", "é*", "x".repeat(129)]) {
      assert.equal(parsePatterns(bad).ok, false, bad);
    }
    const many = Array.from({ length: 101 }, (_, i) => `c${i}`).join("\n");
    assert.deepEqual(parsePatterns(many), { ok: false, error: "err.hiddenLimit" });
  });

  it("persists patterns and applies them only to restricted sessions", () => {
    const db = openDb(":memory:");
    assert.deepEqual(loadHiddenPatterns(db), []);
    saveHiddenPatterns(["podmanmanager*", "x?"], db);
    assert.deepEqual(loadHiddenPatterns(db), ["podmanmanager*", "x?"]);
    const full: SessionInfo = { username: "admin", kind: "local", access: "all", groupIds: [] };
    const ldapAdmin: SessionInfo = { username: "a", kind: "ldap", access: "all", groupIds: [] };
    const scoped: SessionInfo = { username: "c", kind: "ldap", access: "groups", groupIds: [1] };
    assert.deepEqual(hiddenPatternsFor(full, db), []);
    assert.deepEqual(hiddenPatternsFor(ldapAdmin, db), []);
    assert.deepEqual(hiddenPatternsFor(scoped, db), ["podmanmanager*", "x?"]);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'hidden_containers'").run('["ok*","bad pattern",5]');
    assert.deepEqual(loadHiddenPatterns(db), ["ok*"], "stored junk is ignored");
  });

  describe("filtering of live container lists", () => {
    const list = [
      { id: "a".repeat(64), name: "podmanmanager-agent", image: "i", state: "running", status: "running", createdAt: null, startedAt: null },
      { id: "b".repeat(64), name: "podmanmanager-master", image: "i", state: "running", status: "running", createdAt: null, startedAt: null },
      { id: "c".repeat(64), name: "nginx", image: "i", state: "exited", status: "exited", createdAt: null, startedAt: null },
    ];
    let srv: ReturnType<typeof createServer>;
    const db = openDb(":memory:");
    before(async () => {
      srv = createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(req.url === "/api/v1/containers" ? { ok: true, data: list } : { ok: false, error: { code: "NOT_FOUND", message: "x" } }));
      });
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      db.prepare("INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at) VALUES ('a1','h1','127.0.0.1',?, ?, 'now')").run((srv.address() as AddressInfo).port, encryptSecret("tok-0123456789abcdef"));
    });
    after(() => new Promise<void>((r) => srv.close(() => r())));

    it("returns everything without patterns and removes hidden containers (and their count) with patterns", async () => {
      const all = await fetchAllContainers(db);
      assert.equal(all[0]!.result.ok && all[0]!.result.data.length, 3);
      const shown = await fetchAllContainers(db, null, ["podmanmanager*"]);
      assert.deepEqual(shown[0]!.result.ok && shown[0]!.result.data.map((c) => c.name), ["nginx"]);
    });
  });
});
