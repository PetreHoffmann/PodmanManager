import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { auth, jsonRes, startAgent, startFakePodman, type Fake, type Running } from "./helpers.js";

const calls: string[] = [];
let mode: "ok" | "v1" | "empty" | "broken" = "ok";
const ID = "a".repeat(64);

describe("container statistics", () => {
  let fake: Fake;
  let agent: Running;
  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      calls.push(`${req.method} ${u}`);
      if (u.startsWith("/libpod/containers/stats")) {
        if (mode === "v1") return jsonRes(res, 409, { cause: "container stats resource only available for cgroup v2", message: "container stats resource only available for cgroup v2", response: 409 });
        if (mode === "broken") return jsonRes(res, 500, { message: "boom" });
        if (mode === "empty") return jsonRes(res, 200, { Error: null, Stats: [] });
        return jsonRes(res, 200, {
          Error: null,
          Stats: [
            { ContainerID: ID, Name: "web", CPU: 1.5, CPUNano: 2_000_000_000, MemUsage: 52428800, MemLimit: 1073741824, NetInput: 1000, NetOutput: 2000, BlockInput: 4096, BlockOutput: 8192, PIDs: 7 },
            { ContainerID: "b".repeat(64), Name: "db", CPUNano: 5, MemUsage: 10, MemLimit: 0 },
            { Name: "no-id" },
          ],
        });
      }
      jsonRes(res, 404, { message: "x" });
    });
    agent = await startAgent(fake.socketPath, { rateLimitMax: 100 });
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });
  const get = (p: string, method = "GET") => fetch(`${agent.base}/api/v1${p}`, { method, headers: auth });

  it("returns raw counters with a timestamp; skips entries without id", async () => {
    mode = "ok";
    const before = Date.now();
    const d = (await (await get("/stats")).json()).data as { ts: number; containers: Record<string, unknown>[] };
    assert.ok(d.ts >= before && d.ts <= Date.now());
    assert.equal(d.containers.length, 2);
    assert.deepEqual(d.containers[0], { id: ID, name: "web", cpuNano: 2_000_000_000, memUsage: 52428800, memLimit: 1073741824, netIn: 1000, netOut: 2000, blockIn: 4096, blockOut: 8192, pids: 7 });
    assert.equal(d.containers[1]!.memLimit, 0);
    assert.ok(calls.some((c) => c === "GET /libpod/containers/stats?stream=false"), calls.join("\n"));
  });

  it("answers an empty list when nothing runs", async () => {
    mode = "empty";
    assert.deepEqual(((await (await get("/stats")).json()).data as { containers: unknown[] }).containers, []);
  });

  it("reports STATS_UNAVAILABLE on cgroup v1 hosts", async () => {
    mode = "v1";
    const r = await get("/stats");
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "STATS_UNAVAILABLE");
  });

  it("maps other Podman failures to a gateway error", async () => {
    mode = "broken";
    assert.equal((await get("/stats")).status, 502);
  });

  it("is read-only", async () => {
    assert.equal((await get("/stats", "POST")).status, 405);
    assert.equal((await get("/stats/x")).status, 404);
  });
});
