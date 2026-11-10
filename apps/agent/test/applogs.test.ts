import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { LogBuffer, sanitizeLogText } from "../src/logbuffer.js";
import { TOKEN, auth, jsonRes, startAgent, startFakePodman, type Fake, type Running } from "./helpers.js";

describe("log buffer", () => {
  it("keeps only the newest lines", () => {
    const b = new LogBuffer(3);
    for (let i = 0; i < 6; i++) b.push("info", `m${i}`);
    assert.deepEqual(b.tail(10).map((l) => l.text), ["m3", "m4", "m5"]);
    assert.deepEqual(b.tail(2).map((l) => l.text), ["m4", "m5"]);
  });
  it("masks secrets and control characters, truncates", () => {
    assert.equal(sanitizeLogText("auth Bearer abc.def-123 ok"), "auth Bearer *** ok");
    assert.equal(sanitizeLogText("token=SECRET123 password: hunter2"), "token=*** password: ***");
    assert.equal(sanitizeLogText("a\x1b[31mb\nc"), "a [31mb c");
    assert.equal(sanitizeLogText("x".repeat(5000)).length, 1000);
  });
});

describe("GET /api/v1/agent/logs", () => {
  let fake: Fake;
  let agent: Running;
  before(async () => {
    fake = await startFakePodman((_q, r) => jsonRes(r, 200, []));
    agent = await startAgent(fake.socketPath);
    for (let i = 0; i < 4; i++) agent.logs.push("info", `line ${i}`);
    agent.logs.push("error", `failed Bearer ${TOKEN}`);
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });

  it("returns the newest lines with level and never the token", async () => {
    const r = await fetch(`${agent.base}/api/v1/agent/logs?tail=2`, { headers: auth });
    const j = (await r.json()) as { ok: true; data: { lines: { level: string; text: string }[] } };
    assert.equal(r.status, 200);
    assert.deepEqual(j.data.lines.map((l) => [l.level, l.text]), [["info", "line 3"], ["error", "failed Bearer ***"]]);
    assert.ok(!JSON.stringify(j).includes(TOKEN));
  });
  it("defaults, validates tail, requires auth and GET", async () => {
    assert.equal((await fetch(`${agent.base}/api/v1/agent/logs`, { headers: auth })).status, 200);
    for (const q of ["0", "501", "abc", "-1", "1.5"]) assert.equal((await fetch(`${agent.base}/api/v1/agent/logs?tail=${q}`, { headers: auth })).status, 400, q);
    assert.equal((await fetch(`${agent.base}/api/v1/agent/logs`)).status, 401);
    assert.equal((await fetch(`${agent.base}/api/v1/agent/logs`, { method: "POST", headers: auth })).status, 405);
  });
});
