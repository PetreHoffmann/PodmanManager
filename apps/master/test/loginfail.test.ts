import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loginBlocked, recordLoginFailure } from "../src/lib/session";

describe("login failure counting", () => {
  it("returns the number of failures of the name within the last minute; the fifth blocks it", () => {
    const t0 = 1_000_000_000_000;
    const key = "counting-test-user";
    const counts = [0, 1, 2, 3, 4].map((i) => recordLoginFailure(key, t0 + i * 1000));
    assert.deepEqual(counts, [1, 2, 3, 4, 5]);
    assert.equal(loginBlocked(key, t0 + 5000), true);
    assert.equal(loginBlocked(key, t0 + 70_000), false, "after a minute the name is free again");
    assert.equal(recordLoginFailure(key, t0 + 70_000), 1, "and counting starts again");
    assert.equal(recordLoginFailure("COUNTING-TEST-USER", t0 + 71_000), 2, "names are compared case-insensitively");
  });
});
