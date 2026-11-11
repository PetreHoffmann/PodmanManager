import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mapStorage } from "../src/podman/service.js";
import { auth, jsonRes, startAgent, startFakePodman, type Fake, type Running } from "./helpers.js";

// shape and numbers taken from a real Podman 5.8.2 (`podman system df`: images 405.6MB, containers 8.398MB / 3.15MB reclaimable, volumes 20.97MB)
const DF = {
  ImagesSize: 405575446,
  Images: [
    { Repository: "a", Tag: "1", ImageID: "x", Size: 239841554, SharedSize: 239329280, UniqueSize: 512274, Containers: 0 },
    { Repository: "b", Tag: "1", ImageID: "y", Size: 321592911, SharedSize: 239329280, UniqueSize: 82263631, Containers: 0 },
    { Repository: "c", Tag: "1", ImageID: "z", Size: 245102035, SharedSize: 239329280, UniqueSize: 5772755, Containers: 2 },
  ],
  Containers: [
    { ContainerID: "1", Status: "running", RWSize: 5247760, Size: 245102035 },
    { ContainerID: "2", Status: "exited", RWSize: 3150382, Size: 243004657 },
  ],
  Volumes: [{ VolumeName: "v", Links: 1, Size: 20971520, ReclaimableSize: 0 }, { VolumeName: "w", Links: 0, Size: 1000, ReclaimableSize: 1000 }],
};

describe("storage mapping", () => {
  it("sums images, containers and volumes like `podman system df`", () => {
    const s = mapStorage(DF, new Date("2026-11-11T12:00:00Z"));
    assert.deepEqual(s.images, { count: 3, unused: 2, size: 405575446, reclaimable: 512274 + 82263631 });
    assert.deepEqual(s.containers, { count: 2, running: 1, size: 8398142, reclaimable: 3150382 });
    assert.deepEqual(s.volumes, { count: 2, size: 20972520, reclaimable: 1000 });
    assert.equal(s.total, 405575446 + 8398142 + 20972520);
    assert.equal(s.measuredAt, "2026-11-11T12:00:00.000Z");
  });
  it("falls back when ImagesSize is missing and tolerates empty or odd input", () => {
    const { ImagesSize: _drop, ...noTotal } = DF;
    void _drop;
    assert.equal(mapStorage(noTotal).images.size, 512274 + 82263631 + 5772755 + 239329280);
    for (const bad of [null, {}, { Images: "x", Containers: [null, 5], Volumes: [{ Size: -4 }] }]) {
      const s = mapStorage(bad);
      assert.equal(s.total, 0);
    }
  });
});

describe("GET /api/v1/system/storage", () => {
  let fake: Fake;
  let agent: Running;
  let dfCalls = 0;
  let mode: "ok" | "error" = "ok";
  before(async () => {
    fake = await startFakePodman(async (req, res) => {
      if ((req.url ?? "") === "/libpod/system/df") {
        dfCalls++;
        await new Promise((r) => setTimeout(r, 50));
        return mode === "ok" ? jsonRes(res, 200, DF) : jsonRes(res, 500, { message: "df failed" });
      }
      jsonRes(res, 404, { message: "nope" });
    });
    agent = await startAgent(fake.socketPath);
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });
  const get = (h: Record<string, string> = auth, method = "GET") => fetch(`${agent.base}/api/v1/system/storage`, { method, headers: h });

  it("returns the mapped numbers; concurrent and repeated calls share one (cached) query", async () => {
    mode = "error"; // an error must not be cached
    assert.equal((await get()).status, 502);
    mode = "ok";
    dfCalls = 0;
    const rs = await Promise.all([get(), get(), get()]);
    assert.ok(rs.every((r) => r.status === 200));
    const j = (await rs[0]!.json()) as { data: { total: number; volumes: { count: number } } };
    assert.equal(j.data.total, 405575446 + 8398142 + 20972520);
    assert.equal(j.data.volumes.count, 2);
    await get();
    assert.equal(dfCalls, 1, "one query for three concurrent and one later request");
    assert.ok(fake.calls.some((c) => c === "GET /v4.9.3/libpod/system/df"));
  });
  it("requires auth and GET", async () => {
    assert.equal((await get({})).status, 401);
    assert.equal((await get(auth, "POST")).status, 405);
  });
});

describe("agent log of failed Podman calls", () => {
  it("names the request, Podman's HTTP status and message (not only the error code)", async () => {
    const fake = await startFakePodman((req, res) => {
      if ((req.url ?? "") === "/libpod/system/df") return jsonRes(res, 500, { message: "error getting image size: layer not known" });
      jsonRes(res, 404, { message: "nope" });
    });
    const agent = await startAgent(fake.socketPath);
    try {
      const r = await fetch(`${agent.base}/api/v1/system/storage?x=1`, { headers: auth });
      assert.equal(r.status, 502);
      const line = agent.logs.tail(5).find((l) => l.level === "error")?.text ?? "";
      assert.match(line, /^podman error PODMAN_API_ERROR on GET \/api\/v1\/system\/storage \(Podman HTTP 500\): error getting image size: layer not known$/);
      assert.ok(!line.includes("x=1"), "query string is not logged");
    } finally {
      await agent.close();
      await fake.close();
    }
  });
});
