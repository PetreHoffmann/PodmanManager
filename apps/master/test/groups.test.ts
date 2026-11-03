import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { allowedAgentIds, deleteGroup, groupNames, listGroups, mayAccessAgent, saveGroup } from "../src/lib/groups";
import type { SessionInfo } from "../src/lib/session-types";

function setup() {
  const db = openDb(":memory:");
  const ins = db.prepare("INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at) VALUES (?, ?, ?, ?, 'x', 'now')");
  const ids = ["a1", "a2", "a3"].map((n, i) => Number(ins.run(n, n, "10.0.0." + i, 9126).lastInsertRowid));
  return { db, ids };
}
const scoped = (groupIds: number[]): SessionInfo => ({ username: "u", kind: "ldap", access: "groups", groupIds });
const full: SessionInfo = { username: "admin", kind: "local", access: "all", groupIds: [] };

describe("agent groups", () => {
  it("creates, lists and updates groups with agent membership", () => {
    const { db, ids } = setup();
    const r = saveGroup({ name: "Team A", adGroupDn: "CN=A,DC=x", agentIds: [ids[0]!, ids[1]!] }, db);
    assert.ok(r.ok);
    assert.deepEqual(listGroups(db).map((g) => [g.name, g.agentIds]), [["Team A", [ids[0], ids[1]]]]);
    assert.ok(saveGroup({ id: r.ok ? r.id : 0, name: "Team A2", adGroupDn: "CN=A,DC=x", agentIds: [ids[2]!] }, db).ok);
    assert.deepEqual(listGroups(db).map((g) => [g.name, g.agentIds]), [["Team A2", [ids[2]]]]);
  });

  it("validates input and rejects duplicates", () => {
    const { db } = setup();
    assert.deepEqual(saveGroup({ name: " ", adGroupDn: "CN=A", agentIds: [] }, db), { ok: false, error: "err.groupName" });
    assert.deepEqual(saveGroup({ name: "x".repeat(65), adGroupDn: "CN=A", agentIds: [] }, db), { ok: false, error: "err.groupName" });
    assert.deepEqual(saveGroup({ name: "A", adGroupDn: "", agentIds: [] }, db), { ok: false, error: "err.groupDn" });
    assert.ok(saveGroup({ name: "A", adGroupDn: "CN=A", agentIds: [] }, db).ok);
    assert.deepEqual(saveGroup({ name: "a", adGroupDn: "CN=B", agentIds: [] }, db), { ok: false, error: "err.groupDup" });
    assert.deepEqual(saveGroup({ id: 999, name: "Z", adGroupDn: "CN=Z", agentIds: [] }, db), { ok: false, error: "err.groupNotFound" });
  });

  it("ignores unknown agent ids", () => {
    const { db, ids } = setup();
    const r = saveGroup({ name: "A", adGroupDn: "CN=A", agentIds: [ids[0]!, 9999, -1] }, db);
    assert.ok(r.ok);
    assert.deepEqual(listGroups(db)[0]!.agentIds, [ids[0]]);
  });

  it("computes allowed agents: all, none, or the union of the session's groups", () => {
    const { db, ids } = setup();
    const a = saveGroup({ name: "A", adGroupDn: "CN=A", agentIds: [ids[0]!] }, db);
    const b = saveGroup({ name: "B", adGroupDn: "CN=B", agentIds: [ids[0]!, ids[1]!] }, db);
    assert.ok(a.ok && b.ok);
    const [ga, gb] = [(a as { id: number }).id, (b as { id: number }).id];
    assert.equal(allowedAgentIds(full, db), null);
    assert.deepEqual([...allowedAgentIds(scoped([ga]), db)!], [ids[0]]);
    assert.deepEqual([...allowedAgentIds(scoped([ga, gb]), db)!].sort(), [ids[0], ids[1]].sort());
    assert.equal(allowedAgentIds(scoped([]), db)!.size, 0);
    assert.equal(allowedAgentIds(scoped([12345]), db)!.size, 0);
    const allowed = allowedAgentIds(scoped([ga]), db);
    assert.ok(mayAccessAgent(allowed, ids[0]!) && !mayAccessAgent(allowed, ids[2]!) && mayAccessAgent(null, ids[2]!));
    assert.deepEqual(groupNames(scoped([gb, ga]), db), ["A", "B"]);
  });

  it("reflects group assignment changes immediately and cascades deletes", () => {
    const { db, ids } = setup();
    const r = saveGroup({ name: "A", adGroupDn: "CN=A", agentIds: [ids[0]!] }, db) as { ok: true; id: number };
    assert.deepEqual([...allowedAgentIds(scoped([r.id]), db)!], [ids[0]]);
    saveGroup({ id: r.id, name: "A", adGroupDn: "CN=A", agentIds: [ids[1]!] }, db);
    assert.deepEqual([...allowedAgentIds(scoped([r.id]), db)!], [ids[1]]);
    db.prepare("DELETE FROM agents WHERE id = ?").run(ids[1]!);
    assert.equal(allowedAgentIds(scoped([r.id]), db)!.size, 0);
    deleteGroup(r.id, db);
    assert.equal(listGroups(db).length, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM agent_group_members").get() as { n: number }).n, 0);
  });
});
