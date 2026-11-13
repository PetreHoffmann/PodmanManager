import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isBackupName, listBackups, readStoredBackup, runAutoBackup } from "../src/lib/autobackup";

const day = (d: string) => new Date(`${d}T10:00:00Z`);

describe("automatic backups", () => {
  it("writes one copy per day and keeps only the newest ones", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "ab-")), "backups");
    try {
      let n = 0;
      const make = () => Buffer.from(`copy ${++n}`);
      assert.equal(runAutoBackup(0, day("2026-11-01"), dir, make), null);
      assert.equal(existsSync(dir), false);
      assert.equal(runAutoBackup(3, day("2026-11-01"), dir, make), "master-2026-11-01.db");
      assert.equal(runAutoBackup(3, day("2026-11-01"), dir, make), null); // same day: nothing new
      for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) runAutoBackup(3, day(d), dir, make);
      assert.deepEqual(listBackups(dir).map((b) => b.name), ["master-2026-11-05.db", "master-2026-11-04.db", "master-2026-11-03.db"]);
      assert.equal(n, 5);
      assert.equal(statSync(join(dir, "master-2026-11-05.db")).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lowering the number prunes on the next run; foreign files stay", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "ab-")), "backups");
    try {
      const make = () => Buffer.from("x");
      for (const d of ["2026-11-01", "2026-11-02", "2026-11-03"]) runAutoBackup(7, day(d), dir, make);
      writeFileSync(join(dir, "notes.txt"), "keep");
      runAutoBackup(1, day("2026-11-03"), dir, make);
      assert.deepEqual(listBackups(dir).map((b) => b.name), ["master-2026-11-03.db"]);
      assert.equal(readFileSync(join(dir, "notes.txt"), "utf8"), "keep");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("only fixed names can be read back (no path traversal)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ab-"));
    try {
      writeFileSync(join(dir, "master-2026-11-01.db"), "data");
      writeFileSync(join(dir, "secret.txt"), "no");
      assert.equal(readStoredBackup("master-2026-11-01.db", dir)?.toString(), "data");
      for (const bad of ["../secret.txt", "secret.txt", "master-2026-11-01.db/../secret.txt", "/etc/passwd", "master-2026-1-1.db", ""]) assert.equal(readStoredBackup(bad, dir), null, bad);
      assert.equal(isBackupName("master-2026-11-01.db"), true);
      assert.equal(isBackupName("master-2026-11-01.db.bak"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
