import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmtClock, fmtUnit, nearestIndex } from "../src/lib/chart-hover";

describe("chart hover", () => {
  it("finds the nearest measuring point", () => {
    const t = [1000, 2000, 3000, 4000];
    assert.equal(nearestIndex(t, 0), 0);
    assert.equal(nearestIndex(t, 1499), 0);
    assert.equal(nearestIndex(t, 1501), 1);
    assert.equal(nearestIndex(t, 3600), 3);
    assert.equal(nearestIndex(t, 99999), 3);
    assert.equal(nearestIndex([5000], 1), 0);
    assert.equal(nearestIndex([], 1), -1);
  });
  it("formats values per unit, null as dash", () => {
    assert.equal(fmtUnit(null, "percent", "de"), "–");
    assert.equal(fmtUnit(2.14, "percent", "en"), "2.1 %");
    assert.equal(fmtUnit(37.6, "percent", "en"), "38 %");
    assert.equal(fmtUnit(1500, "rate", "en"), "2 kB/s");
    assert.equal(fmtUnit(191_400_000, "bytes", "en"), "191.4 MB");
  });
  it("shows clock time as HH:MM without seconds", () => {
    const s = fmtClock(Date.UTC(2026, 10, 26, 10, 42, 33), "de");
    assert.match(s, /^\d{2}:\d{2}$/);
  });
});
