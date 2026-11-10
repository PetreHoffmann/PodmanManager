import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appLogTail, captureConsole, pushAppLog, sanitizeLogText } from "../src/lib/applog";

describe("master app log", () => {
  it("masks secrets and strips control sequences", () => {
    assert.equal(sanitizeLogText("login Bearer abc123 password=hunter2"), "login Bearer *** password=***");
    assert.equal(sanitizeLogText("\x1b[31mred\x1b[0m\nnext"), "red next");
  });
  it("is a ring buffer of at most 500 lines", () => {
    for (let i = 0; i < 520; i++) pushAppLog("info", `m${i}`);
    assert.equal(appLogTail(1000).length, 500);
    assert.equal(appLogTail(1)[0]?.text, "m519");
  });
  it("mirrors console output with level and keeps printing", () => {
    captureConsole();
    captureConsole(); // idempotent
    const orig = process.stderr.write;
    console.warn("ldap login denied: bad creds token=xyz");
    const l = appLogTail(1)[0];
    assert.equal(l?.level, "warn");
    assert.equal(l?.text, "ldap login denied: bad creds token=***");
    void orig;
  });
});
