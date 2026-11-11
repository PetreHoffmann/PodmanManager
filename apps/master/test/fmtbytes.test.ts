import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmtBytes } from "../src/components/ui";

describe("fmtBytes", () => {
  it("uses decimal units like podman system df", () => {
    assert.equal(fmtBytes(0), "0 B");
    assert.equal(fmtBytes(999), "999 B");
    assert.equal(fmtBytes(1000), "1 kB");
    assert.equal(fmtBytes(405575446), "405.6 MB");
    assert.equal(fmtBytes(14_237_000_000), "14.2 GB");
    assert.equal(fmtBytes(3_000_000_000_000), "3 TB");
  });
  it("uses the language's decimal separator and rejects odd input", () => {
    assert.equal(fmtBytes(14_237_000_000, "de"), "14,2 GB");
    assert.equal(fmtBytes(-1), "—");
    assert.equal(fmtBytes(NaN), "—");
  });
});
