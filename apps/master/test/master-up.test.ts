import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { masterAnswers } from "../src/lib/master-up";

describe("master answers during an update", () => {
  it("counts pages and redirects as up, proxy errors and network failures as down", () => {
    assert.equal(masterAnswers({ status: 200 }), true);
    assert.equal(masterAnswers({ status: 302 }), true);
    assert.equal(masterAnswers({ type: "opaqueredirect", status: 0 }), true);
    assert.equal(masterAnswers({ status: 404 }), true);
    for (const s of [500, 502, 503, 504]) assert.equal(masterAnswers({ status: s }), false, String(s));
    assert.equal(masterAnswers({ type: "error", status: 0 }), false);
  });
});
