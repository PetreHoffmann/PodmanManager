import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { createSession, getSession } from "../src/lib/session";

describe("session display name", () => {
  it("is stored with the session and returned; sessions without one have none", () => {
    const db = openDb(":memory:");
    const a = createSession({ username: "MustermannM", kind: "ldap", access: "groups", groupIds: [1], displayName: "Max Mustermann (MustermannM)" }, db);
    assert.equal(getSession(a, db)?.displayName, "Max Mustermann (MustermannM)");
    const b = createSession({ username: "admin", kind: "local", access: "all", groupIds: [] }, db);
    const s = getSession(b, db);
    assert.ok(s && !("displayName" in s));
  });
  it("an existing database without the column is migrated", () => {
    const db = openDb(":memory:");
    const cols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
    assert.ok(cols.includes("display_name"));
  });
});
