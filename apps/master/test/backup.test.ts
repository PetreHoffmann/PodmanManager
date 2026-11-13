import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { createBackup, restoreBackup } from "../src/lib/backup";
import { encryptSecret } from "../src/lib/crypto";
import { saveGroup } from "../src/lib/groups";
import { createSession, getSession } from "../src/lib/session";
import { getUserByName, saveUser } from "../src/lib/users";

const K1 = Buffer.alloc(32, 1);
const K2 = Buffer.alloc(32, 2);

function seed(key: Buffer) {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at) VALUES ('h1', 'h1', '10.0.0.1', 9126, ?, 'now')").run(encryptSecret("tok", key));
  db.prepare("INSERT INTO admin (id, password_hash) VALUES (1, 'scrypt$a$b')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('brand.text', 'Acme')").run();
  return db;
}

describe("database backup", () => {
  it("contains the data but no sessions", async () => {
    const db = seed(K1);
    const g = saveGroup({ name: "G", adGroupDn: "", agentIds: [] }, db);
    await saveUser({ username: "max", password: "correct-horse-1", isAdmin: false, enabled: true, mustChange: false, groupIds: [g.ok ? g.id : 0] }, db);
    createSession({ username: "admin", kind: "local", access: "all", groupIds: [] }, db);
    const data = createBackup(db);
    const dir = mkdtempSync(join(tmpdir(), "bt-"));
    try {
      const f = join(dir, "x.db");
      require("node:fs").writeFileSync(f, data);
      const c = new DatabaseSync(f, { readOnly: true });
      assert.equal((c.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 0);
      assert.equal((c.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1);
      assert.equal((c.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n, 1);
      c.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("database restore", () => {
  it("replaces the data, ends all sessions and keeps a .bak", async () => {
    const src = seed(K1);
    await saveUser({ username: "max", password: "correct-horse-1", isAdmin: true, enabled: true, mustChange: false, groupIds: [] }, src);
    const data = createBackup(src);

    const dst = openDb(":memory:");
    dst.prepare("INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at) VALUES ('other', 'o', '10.9.9.9', 1, 'x', 'now')").run();
    const tok = createSession({ username: "admin", kind: "local", access: "all", groupIds: [] }, dst);
    const dir = mkdtempSync(join(tmpdir(), "bt-"));
    try {
      const bak = join(dir, "master.db.bak");
      const r = restoreBackup(data, { key: K1 }, dst, bak);
      assert.deepEqual(r, { ok: true, agents: 1, users: 1, groups: 0 });
      assert.deepEqual((dst.prepare("SELECT agent_id FROM agents").all() as { agent_id: string }[]).map((a) => a.agent_id), ["h1"]);
      assert.equal((dst.prepare("SELECT value FROM settings WHERE key = 'brand.text'").get() as { value: string }).value, "Acme");
      assert.ok(getUserByName("max", dst)?.isAdmin);
      assert.equal(getSession(tok, dst), null);
      assert.ok(existsSync(bak));
      const old = new DatabaseSync(bak, { readOnly: true });
      assert.equal((old.prepare("SELECT agent_id FROM agents").get() as { agent_id: string }).agent_id, "other");
      old.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects files that are not a backup", () => {
    const db = openDb(":memory:");
    assert.deepEqual(restoreBackup(Buffer.from("hello"), {}, db, null), { ok: false, error: "err.restoreFile" });
    assert.deepEqual(restoreBackup(Buffer.alloc(4096, 1), {}, db, null), { ok: false, error: "err.restoreFile" });
    // a valid SQLite file that is not ours
    const dir = mkdtempSync(join(tmpdir(), "bt-"));
    try {
      const f = join(dir, "o.db");
      const o = new DatabaseSync(f);
      o.exec("CREATE TABLE t (a); INSERT INTO t VALUES (1);");
      o.close();
      assert.deepEqual(restoreBackup(require("node:fs").readFileSync(f), {}, db, null), { ok: false, error: "err.restoreFile" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a backup without an administrator (it would reopen the first-run setup)", () => {
    const empty = openDb(":memory:");
    const dst = seed(K1);
    assert.deepEqual(restoreBackup(createBackup(empty), {}, dst, null), { ok: false, error: "err.restoreFile" });
    assert.equal((dst.prepare("SELECT COUNT(*) AS n FROM admin").get() as { n: number }).n, 1);
  });

  it("refuses unreadable host tokens unless forced", () => {
    const data = createBackup(seed(K1));
    const dst = openDb(":memory:");
    assert.deepEqual(restoreBackup(data, { key: K2 }, dst, null), { ok: false, error: "err.restoreKey", unreadable: 1 });
    assert.equal((dst.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n, 0);
    assert.equal(restoreBackup(data, { key: K2, force: true }, dst, null).ok, true);
    assert.equal((dst.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n, 1);
  });

  it("accepts a backup of an older version (no users, no host kind)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bt-"));
    try {
      const f = join(dir, "old.db");
      const o = new DatabaseSync(f);
      o.exec(`CREATE TABLE agents (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, address TEXT NOT NULL, port INTEGER NOT NULL, token_enc TEXT NOT NULL, registered_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'unknown', fail_count INTEGER NOT NULL DEFAULT 0, last_heartbeat TEXT, last_error TEXT, agent_version TEXT, podman_version TEXT, UNIQUE(address, port));
        CREATE TABLE admin (id INTEGER PRIMARY KEY CHECK (id = 1), password_hash TEXT NOT NULL);
        CREATE TABLE agent_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, ad_group_dn TEXT NOT NULL);
        CREATE TABLE agent_group_members (group_id INTEGER NOT NULL, agent_id INTEGER NOT NULL, PRIMARY KEY (group_id, agent_id));
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
        INSERT INTO admin VALUES (1, 'scrypt$a$b');
        INSERT INTO agent_groups (name, ad_group_dn) VALUES ('Old', 'CN=Old');
        INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at) VALUES ('h', 'h', '1.1.1.1', 9126, 'x', 'now');`);
      o.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      o.close();
      const buf = require("node:fs").readFileSync(f);
      const dst = openDb(":memory:");
      const r = restoreBackup(buf, {}, dst, null);
      assert.deepEqual(r, { ok: true, agents: 1, users: 0, groups: 1 });
      assert.equal((dst.prepare("SELECT kind FROM agents").get() as { kind: string }).kind, "remote");
      assert.equal((dst.prepare("SELECT saml_group FROM agent_groups").get() as { saml_group: string }).saml_group, "");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
