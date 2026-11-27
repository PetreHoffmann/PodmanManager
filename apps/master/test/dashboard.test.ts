import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countLists, sumImages, sumVolumes } from "../src/lib/dashboard";

describe("dashboard totals", () => {
  it("sums volumes over hosts and counts hosts without an answer", () => {
    assert.deepEqual(sumVolumes([{ volumes: { count: 3, size: 1000 } }, null, { volumes: { count: 0, size: 0 } }, { volumes: { count: 31, size: 18_200_000_000 } }]), { count: 34, size: 18_200_001_000, missing: 1 });
    assert.deepEqual(sumVolumes([]), { count: 0, size: 0, missing: 0 });
  });
  it("counts the items of all readable hosts", () => {
    assert.deepEqual(countLists([{ ok: true, data: [1, 2] }, { ok: false }, { ok: true, data: [] }, { ok: true, data: [3] }]), { count: 3, missing: 1 });
  });
});

describe("dashboard image size", () => {
  it("adds up the images of all hosts and counts hosts without data", () => {
    assert.deepEqual(sumImages([{ images: { size: 1_000 } }, null, { images: { size: 0 } }, { images: { size: 3_100_000_000 } }]), { size: 3_100_001_000, missing: 1 });
    assert.deepEqual(sumImages([]), { size: 0, missing: 0 });
  });
});
