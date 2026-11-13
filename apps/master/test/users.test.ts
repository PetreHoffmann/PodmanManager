import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { saveGroup } from "../src/lib/groups";
import { createSession, getSession } from "../src/lib/session";
import { authenticateUser, deleteUser, getUserByName, listUsers, saveUser, sessionFor, setUserPassword } from "../src/lib/users";

const base = { isAdmin: false, enabled: true, mustChange: false, groupIds: [] as number[] };
const PW = "correct-horse-1";

describe("local users", () => {
  it("creates users and validates input", async () => {
    const db = openDb(":memory:");
    assert.deepEqual(await saveUser({ ...base, username: "admin", password: PW }, db), { ok: false, error: "err.userName" });
    assert.deepEqual(await saveUser({ ...base, username: "Admin", password: PW }, db), { ok: false, error: "err.userName" });
    assert.deepEqual(await saveUser({ ...base, username: "a b", password: PW }, db), { ok: false, error: "err.userName" });
    assert.deepEqual(await saveUser({ ...base, username: "max", password: "short" }, db), { ok: false, error: "err.userPw" });
    assert.ok((await saveUser({ ...base, username: "max", password: PW }, db)).ok);
    assert.deepEqual(await saveUser({ ...base, username: "MAX", password: PW }, db), { ok: false, error: "err.userDup" });
    assert.deepEqual(listUsers(db).map((u) => u.username), ["max"]);
  });

  it("authenticates with distinct internal reasons", async () => {
    const db = openDb(":memory:");
    const g = saveGroup({ name: "G", adGroupDn: "", agentIds: [] }, db);
    assert.ok(g.ok);
    const gid = g.ok ? g.id : 0;
    await saveUser({ ...base, username: "max", password: PW, groupIds: [gid] }, db);
    await saveUser({ ...base, username: "lone", password: PW }, db);
    await saveUser({ ...base, username: "off", password: PW, enabled: false, groupIds: [gid] }, db);
    await saveUser({ ...base, username: "boss", password: PW, isAdmin: true }, db);
    assert.equal((await authenticateUser("nobody", PW, db)).ok, false);
    assert.deepEqual(await authenticateUser("nobody", PW, db), { ok: false, reason: "unknown" });
    assert.deepEqual(await authenticateUser("max", "wrong-password", db), { ok: false, reason: "invalid" });
    assert.deepEqual(await authenticateUser("lone", PW, db), { ok: false, reason: "no_group" });
    assert.deepEqual(await authenticateUser("off", PW, db), { ok: false, reason: "disabled" });
    const r = await authenticateUser("MAX", PW, db);
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(sessionFor(r.user), { username: "max", kind: "user", access: "groups", groupIds: [gid] });
    }
    const b = await authenticateUser("boss", PW, db);
    assert.ok(b.ok && sessionFor(b.user).access === "all");
  });

  it("ends sessions when a user is disabled, changed or deleted", async () => {
    const db = openDb(":memory:");
    const r = await saveUser({ ...base, username: "max", password: PW, isAdmin: true }, db);
    assert.ok(r.ok);
    const id = r.ok ? r.id : 0;
    const tok = createSession(sessionFor(getUserByName("max", db)!), db);
    assert.equal(getSession(tok, db)?.username, "max");
    await saveUser({ ...base, id, username: "max", isAdmin: true, enabled: false }, db);
    assert.equal(getSession(tok, db), null);
    await saveUser({ ...base, id, username: "max", isAdmin: true }, db);
    const t2 = createSession(sessionFor(getUserByName("max", db)!), db);
    assert.ok(getSession(t2, db));
    deleteUser(id, db);
    assert.equal(getSession(t2, db), null);
  });

  it("keeps the password on edit, flags must-change and clears it on password change", async () => {
    const db = openDb(":memory:");
    const r = await saveUser({ ...base, username: "max", password: PW, isAdmin: true, mustChange: true }, db);
    const id = r.ok ? r.id : 0;
    const tok = createSession(sessionFor(getUserByName("max", db)!), db);
    assert.equal(getSession(tok, db)?.mustChange, true);
    assert.deepEqual(await saveUser({ ...base, id, username: "max", password: "x", isAdmin: true }, db), { ok: false, error: "err.userPw" });
    await saveUser({ ...base, id, username: "max", isAdmin: true, mustChange: true }, db);
    assert.ok((await authenticateUser("max", PW, db)).ok);
    await setUserPassword("max", "another-pass-22", db);
    assert.ok((await authenticateUser("max", "another-pass-22", db)).ok);
    assert.equal(getUserByName("max", db)?.mustChange, false);
  });

  it("removes membership when a group is deleted", async () => {
    const db = openDb(":memory:");
    const g = saveGroup({ name: "G", adGroupDn: "", agentIds: [] }, db);
    const gid = g.ok ? g.id : 0;
    await saveUser({ ...base, username: "max", password: PW, groupIds: [gid, 9999] }, db);
    assert.deepEqual(getUserByName("max", db)?.groupIds, [gid]);
    db.prepare("DELETE FROM agent_groups WHERE id = ?").run(gid);
    assert.deepEqual(getUserByName("max", db)?.groupIds, []);
  });
});
