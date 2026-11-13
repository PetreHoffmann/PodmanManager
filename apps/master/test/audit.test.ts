import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { PAGE_SIZE, auditCsv, filterFrom, listAudit, pruneAudit, writeAudit } from "../src/lib/audit";
import { createBackup, restoreBackup } from "../src/lib/backup";

const U = { username: "max", kind: "user" };
const at = (iso: string) => new Date(iso);

describe("audit log", () => {
  it("stores entries and sanitizes text", () => {
    const db = openDb(":memory:");
    writeAudit(U, "container.stop", { target: "web\u0000\nx (abc)", host: "h1", ok: false, detail: "UPSTREAM" }, db, at("2026-11-01T10:00:00Z"));
    writeAudit(null, "login.fail", { ok: false, detail: "unknown user" }, db, at("2026-11-01T10:01:00Z"));
    const r = listAudit({}, 1, db);
    assert.equal(r.total, 2);
    assert.equal(r.rows[0]!.username, "-");
    assert.equal(r.rows[1]!.target, "web  x (abc)");
    assert.equal(r.rows[1]!.ok, false);
  });

  it("filters by user, action, result and day", () => {
    const db = openDb(":memory:");
    writeAudit(U, "container.start", {}, db, at("2026-11-01T23:59:00Z"));
    writeAudit({ username: "anna", kind: "ldap" }, "container.stop", { ok: false }, db, at("2026-11-02T00:01:00Z"));
    writeAudit(U, "image.delete", {}, db, at("2026-11-03T12:00:00Z"));
    assert.equal(listAudit({ user: "ma" }, 1, db).total, 2);
    assert.equal(listAudit({ action: "container.stop" }, 1, db).total, 1);
    assert.equal(listAudit({ action: "not-an-action" }, 1, db).total, 3);
    assert.equal(listAudit({ result: "fail" }, 1, db).total, 1);
    assert.equal(listAudit({ from: "2026-11-02", to: "2026-11-02" }, 1, db).rows[0]!.username, "anna");
    assert.equal(listAudit({ from: "2026-11-02" }, 1, db).total, 2);
    assert.equal(listAudit({ user: "%" }, 1, db).total, 0); // wildcards are literal
    assert.equal(listAudit({ from: "garbage'; DROP TABLE audit;--" }, 1, db).total, 3);
  });

  it("pages newest first", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < PAGE_SIZE + 5; i++) writeAudit(U, "login.ok", { target: String(i) }, db, at("2026-11-01T10:00:00Z"));
    const p1 = listAudit({}, 1, db);
    assert.equal(p1.pages, 2);
    assert.equal(p1.rows.length, PAGE_SIZE);
    assert.equal(p1.rows[0]!.target, String(PAGE_SIZE + 4));
    assert.equal(listAudit({}, 2, db).rows.length, 5);
    assert.equal(listAudit({}, 99, db).page, 2);
  });

  it("prunes old entries only", () => {
    const db = openDb(":memory:");
    writeAudit(U, "login.ok", {}, db, at("2025-01-01T00:00:00Z"));
    writeAudit(U, "login.ok", {}, db, at("2026-10-30T00:00:00Z"));
    assert.equal(pruneAudit(0, db, at("2026-11-13T00:00:00Z")), 0);
    assert.equal(pruneAudit(365, db, at("2026-11-13T00:00:00Z")), 1);
    assert.equal(listAudit({}, 1, db).total, 1);
  });

  it("exports CSV that cannot run formulas", () => {
    const db = openDb(":memory:");
    writeAudit({ username: "=cmd|' /C calc'!A0", kind: "user" }, "login.fail", { target: 'a,"b"', ok: false }, db, at("2026-11-01T10:00:00Z"));
    const csv = auditCsv({}, db);
    const [head, row] = csv.trim().split("\r\n");
    assert.equal(head, "time_utc,user,kind,action,target,host,result,detail,ip");
    assert.ok(row!.includes("'=cmd"));
    assert.ok(row!.includes('"a,""b"""'));
  });

  it("survives a restore of a backup (the current log stays)", () => {
    const src = openDb(":memory:");
    src.prepare("INSERT INTO admin (id, password_hash) VALUES (1, 'x')").run();
    writeAudit(U, "login.ok", { target: "from backup" }, src);
    const data = createBackup(src);
    const dst = openDb(":memory:");
    dst.prepare("INSERT INTO admin (id, password_hash) VALUES (1, 'y')").run();
    writeAudit(U, "backup.restore", { target: "current" }, dst);
    assert.equal(restoreBackup(data, {}, dst, null).ok, true);
    assert.deepEqual(listAudit({}, 1, dst).rows.map((r) => r.target), ["current"]);
  });

  it("reads the filter from a query string", () => {
    assert.deepEqual(filterFrom(new URLSearchParams("user=max&result=fail&from=2026-11-01")), { user: "max", action: undefined, result: "fail", from: "2026-11-01", to: undefined });
    assert.equal(filterFrom(new URLSearchParams("result=x")).result, undefined);
  });
});
