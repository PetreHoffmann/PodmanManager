import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { classifyImage, containerIdFromMountinfo } from "../src/services/update.js";
import { auth, jsonRes, startAgent, startFakePodman, type Fake, type Running } from "./helpers.js";

const SELF = "c".repeat(64);
const OLD = "1".repeat(64);
const NEW = "2".repeat(64);
const IMG = "docker.io/petrecalinoiu/podmanmanager-agent:latest";
const mountinfo = (id = SELF) => [
  `143 125 254:0 /run/user/1000/containers/overlay-containers/${id}/userdata/resolv.conf /etc/resolv.conf rw - ext4 /dev/vda rw`,
  `144 125 254:0 /run/user/1000/containers/overlay-containers/${id}/userdata/hosts /etc/hosts rw - ext4 /dev/vda rw`,
  `147 125 254:0 /run/user/1000/containers/overlay-containers/${id}/userdata/hostname /etc/hostname rw - ext4 /dev/vda rw`,
  `150 125 0:99 /home/u/.local/share/containers/storage/overlay-containers/${"d".repeat(64)}/userdata/x /x rw - tmpfs tmpfs rw`,
].join("\n");

describe("self identification and image classification", () => {
  it("takes the container id from the most frequent overlay-containers path", () => {
    assert.equal(containerIdFromMountinfo(mountinfo()), SELF);
    assert.equal(containerIdFromMountinfo("100 1 0:1 / / rw - overlay overlay rw"), null, "not in a container");
    assert.equal(containerIdFromMountinfo(""), null);
  });
  it("floating tags can be updated by pulling again, version tags and digests cannot", () => {
    for (const ok of ["docker.io/x/agent:latest", "docker.io/x/agent:0.9", "docker.io/x/agent:0", "docker.io/x/agent", "localhost:5000/x/agent:latest"]) assert.equal(classifyImage(ok).floating, true, ok);
    for (const bad of ["docker.io/x/agent:0.9.2", "docker.io/x/agent:v0.9.2", "docker.io/x/agent:sha-abc123", "docker.io/x/agent@sha256:" + "a".repeat(64), ""]) assert.equal(classifyImage(bad).floating, false, bad);
    assert.equal(classifyImage("localhost:5000/x/agent").tag, "latest", "a registry port is not a tag");
  });
});

describe("agent self-update routes", () => {
  let fake: Fake;
  let agent: Running;
  const exits: number[] = [];
  let labels: Record<string, string> = { PODMAN_SYSTEMD_UNIT: "podmanmanager-agent.service" };
  let imageName = IMG;
  let inspectStatus = 200;
  let pullId = NEW;
  let pullBody: string | null = null;
  let pullDelay = 0;
  let mi = mountinfo();
  const pulls: string[] = [];

  // the updater keeps its state until the process exits, so every test gets a fresh agent
  const restartAgent = async () => {
    if (agent) await agent.close();
    agent = await startAgent(fake.socketPath, {}, { mountinfo: () => mi, exit: (c) => void exits.push(c), exitDelayMs: 10 });
  };

  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      if (u === `/libpod/containers/${SELF}/json`) {
        if (inspectStatus !== 200) return jsonRes(res, inspectStatus, { message: "no such container" });
        return jsonRes(res, 200, { Id: SELF, Name: "podmanmanager-agent", ImageName: imageName, Image: OLD, Config: { Labels: labels } });
      }
      if (u.startsWith("/libpod/images/pull?")) {
        pulls.push(u);
        setTimeout(() => {
          res.writeHead(200);
          res.end(pullBody ?? JSON.stringify({ images: [pullId], id: pullId }) + "\n");
        }, pullDelay);
        return;
      }
      jsonRes(res, 404, { message: "nope" });
    });
    await restartAgent();
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });
  const call = (method: string, headers: Record<string, string> = auth) => fetch(`${agent.base}/api/v1/system/update`, { method, headers });
  const info = async () => ((await (await call("GET")).json()) as { data: { possible: boolean; reason?: string; state: string; message?: string; image?: string; tag?: string } }).data;
  const waitState = async (s: string) => {
    for (let i = 0; i < 100; i++) {
      const d = await info();
      if (d.state === s) return d;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("state " + s + " not reached: " + JSON.stringify(await info()));
  };
  const reset = async () => {
    await restartAgent();
    exits.length = 0;
    pulls.length = 0;
    labels = { PODMAN_SYSTEMD_UNIT: "podmanmanager-agent.service" };
    imageName = IMG;
    inspectStatus = 200;
    pullId = NEW;
    pullBody = null;
    pullDelay = 0;
    mi = mountinfo();
  };

  it("reports that it can update: Quadlet/systemd container from a floating tag", async () => {
    await reset();
    assert.deepEqual(await info(), { possible: true, image: IMG, tag: "latest", state: "idle" });
  });

  it("pulls its own image and restarts (non-zero exit so that systemd restarts it) when the image changed", async () => {
    await reset();
    const r = await call("POST");
    assert.equal(r.status, 202);
    assert.equal(((await r.json()) as { data: { state: string } }).data.state, "pulling");
    await waitState("restarting");
    await new Promise((r2) => setTimeout(r2, 60));
    assert.deepEqual(exits, [1]);
    assert.deepEqual(pulls, [`/libpod/images/pull?reference=${encodeURIComponent(IMG)}&quiet=true`], "exactly the agent's own image");
  });

  it("does nothing when the pulled image is the one that is running", async () => {
    await reset();
    pullId = OLD;
    await call("POST");
    const d = await waitState("current");
    assert.equal(d.message, "Already up to date");
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(exits, []);
  });

  it("reports a failed pull (Podman answers 200 with an error) and does not restart", async () => {
    await reset();
    pullBody = JSON.stringify({ error: "unable to copy from source: network is unreachable" }) + "\n";
    await call("POST");
    const d = await waitState("error");
    assert.match(d.message ?? "", /network is unreachable/);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(exits, []);
  });

  it("an update that is already running is not started twice", async () => {
    await reset();
    pullDelay = 150;
    const a = await call("POST");
    const b = await call("POST");
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    await waitState("restarting");
    assert.equal(pulls.length, 1);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(exits, [1]);
  });

  it("refuses when it cannot update itself, with the reason", async () => {
    for (const [setup, reason] of [
      [() => { imageName = "docker.io/petrecalinoiu/podmanmanager-agent:0.9.2"; }, "pinned_tag"],
      [() => { imageName = "docker.io/x/agent@sha256:" + "a".repeat(64); }, "pinned_tag"],
      [() => { labels = {}; }, "not_systemd"],
      [() => { mi = "100 1 0:1 / / rw - overlay overlay rw"; }, "no_container"],
      [() => { inspectStatus = 404; }, "inspect_failed"],
    ] as const) {
      await reset();
      setup();
      const d = await info();
      assert.equal(d.possible, false);
      assert.equal(d.reason, reason);
      const r = await call("POST");
      assert.equal(r.status, 409);
      const j = (await r.json()) as { error: { code: string; message: string } };
      assert.deepEqual(j.error, { code: "UPDATE_NOT_POSSIBLE", message: reason });
      assert.deepEqual(pulls, [], "nothing is pulled when it cannot work");
    }
  });

  it("requires the token; only GET and POST", async () => {
    await reset();
    assert.equal((await call("GET", {})).status, 401);
    assert.equal((await call("POST", {})).status, 401);
    assert.equal((await call("DELETE")).status, 405);
    assert.equal((await call("PUT")).status, 405);
  });
});

describe("agent without update support in the process", () => {
  it("answers 404 like an unknown route", async () => {
    const fake = await startFakePodman((_q, r) => jsonRes(r, 200, []));
    const agent = await startAgent(fake.socketPath);
    try {
      assert.equal((await fetch(`${agent.base}/api/v1/system/update`, { headers: auth })).status, 404);
    } finally {
      await agent.close();
      await fake.close();
    }
  });
});
