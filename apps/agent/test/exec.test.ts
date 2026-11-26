import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadExecSettings } from "../src/config/config.js";
import { clip, demux, parseExecRequest } from "../src/podman/exec.js";
import { ID, auth, jsonRes, startAgent, startFakePodman } from "./helpers.js";

const frame = (type: number, text: string) => { const p = Buffer.from(text); const h = Buffer.alloc(8); h[0] = type; h.writeUInt32BE(p.length, 4); return Buffer.concat([h, p]); };

describe("exec settings", () => {
  it("is off by default; EXEC_ALLOW is a list", () => {
    assert.deepEqual(loadExecSettings({}), { enabled: false, allow: [] });
    assert.deepEqual(loadExecSettings({ EXEC_ENABLED: "true", EXEC_ALLOW: "ls, cat ,,nginx" }), { enabled: true, allow: ["ls", "cat", "nginx"] });
    assert.equal(loadExecSettings({ EXEC_ENABLED: "no" }).enabled, false);
  });
});

describe("exec request validation", () => {
  const ok = (i: unknown) => { const r = parseExecRequest(i); assert.equal(r.ok, true, JSON.stringify(r)); return (r as { ok: true; req: { cmd: string[]; timeoutSec: number } }).req; };
  const bad = (i: unknown, re: RegExp) => { const r = parseExecRequest(i); assert.equal(r.ok, false, JSON.stringify(i)); assert.match((r as { ok: false; message: string }).message, re); };
  it("accepts a list of arguments with defaults", () => {
    assert.deepEqual(ok({ cmd: ["ls", "-l", "/data"] }), { cmd: ["ls", "-l", "/data"], timeoutSec: 15 });
    assert.equal(ok({ cmd: ["ls"], timeoutSec: 60 }).timeoutSec, 60);
  });
  it("rejects everything else", () => {
    bad(null, /object/); bad([], /object/);
    bad({ cmd: "ls -l" }, /arguments/); bad({ cmd: [] }, /arguments/);
    bad({ cmd: Array.from({ length: 21 }, () => "x") }, /arguments/);
    bad({ cmd: [""] }, /empty/); bad({ cmd: ["ls", 1] }, /argument/); bad({ cmd: ["a\0b"] }, /argument/); bad({ cmd: ["x".repeat(1025)] }, /argument/);
    bad({ cmd: ["ls"], timeoutSec: 0 }, /time limit/); bad({ cmd: ["ls"], timeoutSec: 61 }, /time limit/); bad({ cmd: ["ls"], timeoutSec: 1.5 }, /time limit/);
    for (const f of ["env", "user", "privileged", "tty", "workdir", "stdin"]) bad({ cmd: ["ls"], [f]: true }, /Unknown field/);
  });
  it("demultiplexes the stream and cuts the output", () => {
    const d = demux(Buffer.concat([frame(1, "out1\n"), frame(2, "err\n"), frame(1, "out2")]));
    assert.equal(d.stdout.toString(), "out1\nout2");
    assert.equal(d.stderr.toString(), "err\n");
    assert.deepEqual(clip(Buffer.from("abcdef"), 3), ["abc", true]);
    assert.deepEqual(clip(Buffer.from("abc"), 3), ["abc", false]);
    assert.equal(demux(Buffer.from([1, 0, 0, 0, 0, 0, 0, 9, 65])).stdout.toString(), "A", "a cut frame keeps what arrived");
  });
});

describe("exec route", () => {
  const EXECID = "c".repeat(64);
  const seen: { url: string; body: string }[] = [];
  let mode: "ok" | "big" | "hang" | "stopped" = "ok";
  const start = () => startFakePodman((req, res) => {
    const u = req.url ?? "";
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      seen.push({ url: u, body: b });
      if (u === `/libpod/containers/${ID}/exec`) return mode === "stopped" ? jsonRes(res, 409, { message: "container state improper" }) : jsonRes(res, 201, { Id: EXECID });
      if (u === `/libpod/containers/${"d".repeat(64)}/exec`) return jsonRes(res, 404, { message: "no such container" });
      if (u === `/libpod/exec/${EXECID}/start`) {
        if (mode === "hang") return; // never answers: the agent must stop waiting
        res.writeHead(200);
        if (mode === "big") return res.end(Buffer.concat([frame(1, "x".repeat(200_000))]));
        return res.end(Buffer.concat([frame(1, "hello\n"), frame(2, "oops\n")]));
      }
      if (u === `/libpod/exec/${EXECID}/json`) return jsonRes(res, 200, { Running: false, ExitCode: 3 });
      jsonRes(res, 404, { message: "nope" });
    });
  });
  const run = async (exec: { enabled: boolean; allow: string[] }, f: (post: (body: unknown, id?: string) => Promise<Response>) => Promise<void>) => {
    const fake = await start();
    const agent = await startAgent(fake.socketPath, { rateLimitMax: 1000, exec });
    try { await f((body, id = ID) => fetch(`${agent.base}/api/v1/containers/${id}/exec`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) })); }
    finally { await agent.close(); await fake.close(); }
  };
  it("is switched off by default and never reaches podman", async () => {
    seen.length = 0;
    await run({ enabled: false, allow: [] }, async (post) => {
      const r = await post({ cmd: ["ls"] });
      assert.equal(r.status, 403);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, "EXEC_DISABLED");
      assert.equal(seen.length, 0);
    });
  });
  it("runs a command: output of both streams and the exit code; podman gets only the validated fields", async () => {
    seen.length = 0; mode = "ok";
    await run({ enabled: true, allow: [] }, async (post) => {
      const r = await post({ cmd: ["sh", "-c", "echo hello"] });
      assert.equal(r.status, 200);
      const b = (await r.json()) as { data: { exitCode: number; stdout: string; stderr: string; truncated: boolean; timedOut: boolean } };
      assert.deepEqual(b.data, { exitCode: 3, stdout: "hello\n", stderr: "oops\n", truncated: false, timedOut: false });
      const create = JSON.parse(seen.find((s) => s.url.endsWith("/exec"))!.body);
      assert.deepEqual(create, { Cmd: ["sh", "-c", "echo hello"], AttachStdout: true, AttachStderr: true, AttachStdin: false, Tty: false, Privileged: false });
    });
  });
  it("EXEC_ALLOW limits the programs", async () => {
    seen.length = 0; mode = "ok";
    await run({ enabled: true, allow: ["ls"] }, async (post) => {
      assert.equal((await post({ cmd: ["cat", "/etc/passwd"] })).status, 403);
      assert.equal(seen.length, 0);
      assert.equal((await post({ cmd: ["ls", "/"] })).status, 200);
    });
  });
  it("rejects invalid requests, unknown and stopped containers", async () => {
    mode = "ok";
    await run({ enabled: true, allow: [] }, async (post) => {
      assert.equal((await post({ cmd: "ls" })).status, 400);
      assert.equal((await post({ cmd: ["ls"], privileged: true })).status, 400);
      assert.equal((await post({ cmd: ["ls"] }, "d".repeat(64))).status, 404);
      mode = "stopped";
      const r = await post({ cmd: ["ls"] });
      assert.equal(r.status, 400);
      assert.match(((await r.json()) as { error: { message: string } }).error.message, /not running/);
      mode = "ok";
    });
  });
  it("cuts a huge output", async () => {
    mode = "big";
    await run({ enabled: true, allow: [] }, async (post) => {
      const b = (await (await post({ cmd: ["yes"] })).json()) as { data: { stdout: string; truncated: boolean; exitCode: number | null } };
      assert.equal(b.data.truncated, true);
      assert.ok(b.data.stdout.length <= 64 * 1024);
      assert.equal(b.data.exitCode, null);
    });
    mode = "ok";
  });
  it("stops waiting at the time limit", async () => {
    mode = "hang";
    await run({ enabled: true, allow: [] }, async (post) => {
      const t0 = Date.now();
      const b = (await (await post({ cmd: ["sleep", "30"], timeoutSec: 1 })).json()) as { data: { timedOut: boolean; exitCode: number | null } };
      assert.equal(b.data.timedOut, true);
      assert.equal(b.data.exitCode, null);
      assert.ok(Date.now() - t0 < 5000);
    });
    mode = "ok";
  });
  it("health tells whether exec is on", async () => {
    mode = "ok";
    const fake = await start();
    for (const enabled of [false, true]) {
      const agent = await startAgent(fake.socketPath, { rateLimitMax: 1000, exec: { enabled, allow: [] } });
      try { assert.equal(((await (await fetch(`${agent.base}/api/v1/health`, { headers: auth })).json()) as { data: { execEnabled: boolean } }).data.execEnabled, enabled); }
      finally { await agent.close(); }
    }
    await fake.close();
  });
});
