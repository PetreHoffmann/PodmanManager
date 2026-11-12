import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { auth, jsonRes, startAgent, startFakePodman, type Fake, type Running } from "./helpers.js";

const M = "e".repeat(64);
const OLD = "1".repeat(64);
const NEW = "2".repeat(64);
let image = "docker.io/petrecalinoiu/podmanmanager-master:latest";
let found = true;
let pullId = NEW;
const calls: string[] = [];

describe("update of the master container by the agent", () => {
  let fake: Fake;
  let agent: Running | undefined;
  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      calls.push(`${req.method} ${u}`);
      if (u.startsWith("/libpod/containers/json?")) {
        const f = JSON.parse(decodeURIComponent(u.split("filters=")[1]!.split("&")[0]!));
        assert.deepEqual(f, { label: ["PODMAN_SYSTEMD_UNIT=podmanmanager-master.service"] });
        return jsonRes(res, 200, found ? [{ Id: M }] : []);
      }
      if (u === `/libpod/containers/${M}/json`) return jsonRes(res, 200, { Id: M, Name: "m", ImageName: image, Image: OLD, Config: { Labels: {} }, State: {}, Created: "2026-01-01T00:00:00Z" });
      if (u.startsWith("/libpod/images/pull?")) {
        res.writeHead(200);
        return void res.end(JSON.stringify({ images: [pullId], id: pullId }) + "\n");
      }
      if (u.startsWith(`/libpod/containers/${M}/stop`)) return jsonRes(res, 204);
      jsonRes(res, 404, { message: "x" });
    });
  });
  after(() => fake.close());
  afterEach(async () => {
    await agent?.close();
    agent = undefined;
    calls.length = 0;
    image = "docker.io/petrecalinoiu/podmanmanager-master:latest";
    found = true;
    pullId = NEW;
  });
  const run = async (unit?: string) => (agent = await startAgent(fake.socketPath, {}, undefined, unit));
  const wait = async (base: string) => {
    for (let i = 0; i < 50; i++) {
      const d = (await (await fetch(`${base}/api/v1/system/update-peer`, { headers: auth })).json()).data;
      if (d.state !== "pulling") return d;
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it("pulls the image of the unit's container and stops it when the image changed", async () => {
    const a = await run("podmanmanager-master");
    const info = await (await fetch(`${a.base}/api/v1/system/update-peer`, { headers: auth })).json();
    assert.equal(info.data.possible, true);
    assert.equal(info.data.tag, "latest");
    const r = await fetch(`${a.base}/api/v1/system/update-peer`, { method: "POST", headers: auth });
    assert.equal(r.status, 202);
    const d = await wait(a.base);
    assert.equal(d.state, "restarting");
    assert.ok(calls.some((c) => c.startsWith(`POST /libpod/images/pull?reference=${encodeURIComponent(image)}`)));
    assert.ok(calls.some((c) => c.startsWith(`POST /libpod/containers/${M}/stop`)));
  });

  it("does not stop the container when the image is unchanged", async () => {
    pullId = OLD;
    const a = await run("podmanmanager-master");
    await fetch(`${a.base}/api/v1/system/update-peer`, { method: "POST", headers: auth });
    assert.equal((await wait(a.base)).state, "current");
    assert.ok(!calls.some((c) => c.includes("/stop")));
  });

  it("refuses pinned tags and a missing container (409), and 404 when no unit is configured", async () => {
    image = "docker.io/petrecalinoiu/podmanmanager-master:0.9.2";
    let a = await run("podmanmanager-master");
    let r = await fetch(`${a.base}/api/v1/system/update-peer`, { method: "POST", headers: auth });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.message, "pinned_tag");
    assert.ok(!calls.some((c) => c.includes("/pull")));
    await a.close();
    image = "docker.io/petrecalinoiu/podmanmanager-master:latest";
    found = false;
    a = agent = await startAgent(fake.socketPath, {}, undefined, "podmanmanager-master");
    r = await fetch(`${a.base}/api/v1/system/update-peer`, { method: "POST", headers: auth });
    assert.equal((await r.json()).error.message, "no_container");
    await a.close();
    a = agent = await startAgent(fake.socketPath, {});
    assert.equal((await fetch(`${a.base}/api/v1/system/update-peer`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${a.base}/api/v1/system/update-peer`)).status, 401);
  });
});
