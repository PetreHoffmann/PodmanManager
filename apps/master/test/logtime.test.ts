import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { logStamp } from "../src/lib/logtime";

describe("log time stamps", () => {
  it("show date and time (UTC as delivered), also with fractions and offsets", () => {
    assert.equal(logStamp("2026-11-13T17:56:17Z"), "2026-11-13 17:56:17");
    assert.equal(logStamp("2026-11-13T17:56:17.123456789Z"), "2026-11-13 17:56:17");
    assert.equal(logStamp("2026-11-13T17:56:17.5+00:00"), "2026-11-13 17:56:17");
    assert.equal(logStamp("2026-11-13 17:56:17"), "2026-11-13 17:56:17");
  });
  it("a missing or unparsable stamp is a dash, never part of another text", () => {
    for (const v of [null, undefined, "", "yesterday", "17:56:17"]) assert.equal(logStamp(v), "—");
  });
});
