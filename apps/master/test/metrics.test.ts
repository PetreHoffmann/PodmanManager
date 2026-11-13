import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContainerStatsRaw } from "../../../shared/types/index.js";
import { MAX_POINTS, ingest, latestFor, newStore, seriesFor } from "../src/lib/metrics";

const raw = (over: Partial<ContainerStatsRaw> = {}): ContainerStatsRaw => ({ id: "a".repeat(64), name: "web", cpuNano: 0, memUsage: 100, memLimit: 1000, netIn: 0, netOut: 0, blockIn: 0, blockOut: 0, pids: 3, ...over });
const O = { keepMs: 60 * 60_000, intervalMs: 30_000 };
const T0 = 1_800_000_000_000;

describe("container metrics", () => {
  it("computes CPU percent of one core and byte rates from two reports", () => {
    const s = newStore();
    ingest(s, 1, { ts: T0, containers: [raw()] }, { ...O, now: T0 });
    ingest(s, 1, { ts: T0 + 30_000, containers: [raw({ cpuNano: 15_000_000_000, netIn: 3000, netOut: 6000, blockIn: 30_000, blockOut: 60_000, memUsage: 200 })] }, { ...O, now: T0 + 30_000 });
    const p = seriesFor(1, "a".repeat(64), s)!.points;
    assert.equal(p.length, 2);
    assert.equal(p[0]!.cpu, null); // the first sample has nothing to compare with
    assert.equal(p[1]!.cpu, 50); // 15 s of CPU in 30 s = half a core
    assert.deepEqual([p[1]!.netIn, p[1]!.netOut, p[1]!.blockIn, p[1]!.blockOut], [100, 200, 1000, 2000]);
    assert.equal(p[1]!.mem, 200);
  });

  it("shows a counter reset (container restart) as a gap, not a spike", () => {
    const s = newStore();
    ingest(s, 1, { ts: T0, containers: [raw({ cpuNano: 9e9, netIn: 5000 })] }, { ...O, now: T0 });
    ingest(s, 1, { ts: T0 + 30_000, containers: [raw({ cpuNano: 1e9, netIn: 10 })] }, { ...O, now: T0 + 30_000 });
    ingest(s, 1, { ts: T0 + 60_000, containers: [raw({ cpuNano: 4e9, netIn: 310 })] }, { ...O, now: T0 + 60_000 });
    const p = seriesFor(1, "a".repeat(64), s)!.points;
    assert.equal(p[1]!.cpu, null);
    assert.equal(p[1]!.netIn, null);
    assert.equal(p[2]!.cpu, 10); // 3 s of CPU in 30 s
    assert.equal(p[2]!.netIn, 10);
  });

  it("makes no rate across a long gap (host was unreachable)", () => {
    const s = newStore();
    ingest(s, 1, { ts: T0, containers: [raw({ cpuNano: 1e9 })] }, { ...O, now: T0 });
    ingest(s, 1, { ts: T0 + 10 * 60_000, containers: [raw({ cpuNano: 2e9 })] }, { ...O, now: T0 + 10 * 60_000 });
    assert.equal(seriesFor(1, "a".repeat(64), s)!.points[1]!.cpu, null);
  });

  it("drops old points and series of containers that are gone, and keeps hosts apart", () => {
    const s = newStore();
    ingest(s, 1, { ts: T0, containers: [raw()] }, { ...O, now: T0 });
    ingest(s, 2, { ts: T0, containers: [raw()] }, { ...O, now: T0 });
    const later = T0 + 61 * 60_000;
    ingest(s, 1, { ts: later, containers: [raw({ id: "b".repeat(64), name: "db" })] }, { ...O, now: later });
    assert.equal(seriesFor(1, "a".repeat(64), s), null, "expired on host 1");
    assert.equal(seriesFor(1, "b".repeat(64), s)!.name, "db");
    assert.ok(seriesFor(2, "a".repeat(64), s), "host 2 is untouched by host 1's report");
  });

  it("caps the number of points per container", () => {
    const s = newStore();
    for (let i = 0; i < MAX_POINTS + 50; i++) ingest(s, 1, { ts: T0 + i * 5000, containers: [raw({ cpuNano: i * 1e9 })] }, { keepMs: 1440 * 60_000, intervalMs: 5000, now: T0 + i * 5000 });
    assert.equal(seriesFor(1, "a".repeat(64), s)!.points.length, MAX_POINTS);
  });

  it("reports the latest value only for containers that still report", () => {
    const s = newStore();
    ingest(s, 1, { ts: T0, containers: [raw(), raw({ id: "c".repeat(64), name: "old" })] }, { ...O, now: T0 });
    ingest(s, 1, { ts: T0 + 120_000, containers: [raw({ cpuNano: 3e9 })] }, { ...O, now: T0 + 120_000 });
    const l = latestFor(1, s, T0 + 121_000, 90_000);
    assert.ok(l.has("a".repeat(64)));
    assert.equal(l.has("c".repeat(64)), false, "its last sample is 121 s old, older than the limit");
  });
});
