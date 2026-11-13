import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { openDb } from "../src/database/db";
import { agentAction, agentHealth, agentImages, agentInspect, agentList, agentPods, agentSelfInfo, agentUpdateStart, agentAppLogs } from "../src/lib/agent-client";
import { checkAgent, ensureLocalHost, fetchAllContainers, getAgent, listAgents, removeAgent, targetFor } from "../src/lib/agents";
import { pushAppLog } from "../src/lib/applog";
import { jsonRes, startFakePodman, type Fake } from "../../agent/test/helpers";

process.env.MASTER_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");

const C1 = "a".repeat(64);
const IMG = "b".repeat(64);
const calls: string[] = [];

describe("the master's own host (in-process agent)", () => {
  let fake: Fake;
  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      calls.push(`${req.method} ${u}`);
      if (u === "/libpod/info") return jsonRes(res, 200, { host: { hostname: "web-host-01" } });
      if (u === "/libpod/version") return jsonRes(res, 200, { Version: "5.8.2", ApiVersion: "5.8.2" });
      if (u === "/libpod/containers/json?all=true") return jsonRes(res, 200, [{ Id: C1, Names: ["nginx"], Image: "docker.io/library/nginx:1", ImageID: IMG, State: "running", Status: "Up", Created: "2026-10-20T08:15:00Z" }]);
      if (u === `/libpod/containers/${C1}/json`) return jsonRes(res, 200, { Id: C1, Name: "nginx", ImageName: "docker.io/library/nginx:1", State: { Status: "running" }, Created: "2026-10-20T08:15:00Z" });
      if (u.startsWith(`/libpod/containers/${C1}/stop`)) return jsonRes(res, 204);
      if (u === "/libpod/pods/json") return jsonRes(res, 200, []);
      if (u === "/libpod/images/json") return jsonRes(res, 200, [{ Id: IMG, RepoTags: ["docker.io/library/nginx:1"], Size: 1000, Created: 1794323775 }]);
      jsonRes(res, 404, { message: "nope" });
    });
    process.env.LOCAL_PODMAN_SOCKET = fake.socketPath;
  });
  after(async () => {
    delete process.env.LOCAL_PODMAN_SOCKET;
    await fake.close();
  });

  it("is added as a host without address and token when LOCAL_PODMAN_SOCKET is set, and removed when it is not", () => {
    const db = openDb(":memory:");
    ensureLocalHost(db);
    ensureLocalHost(db); // idempotent
    const rows = listAgents(db);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0]!.kind, rows[0]!.agent_id, rows[0]!.address, rows[0]!.port], ["local", "local", "local", 0]);
    assert.deepEqual(targetFor(rows[0]!.id, db), { address: "local", port: 0, token: "", local: true });
    const keep = process.env.LOCAL_PODMAN_SOCKET;
    delete process.env.LOCAL_PODMAN_SOCKET;
    assert.equal(targetFor(rows[0]!.id, db), null, "without the variable there is no target");
    ensureLocalHost(db);
    assert.equal(listAgents(db).length, 0, "switched off: the row is gone");
    process.env.LOCAL_PODMAN_SOCKET = keep;
  });

  it("an agent that already uses the id \"local\" does not clash", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO agents (agent_id, hostname, address, port, token_enc, registered_at) VALUES ('local','x','10.0.0.1',9126,'e','now')").run();
    ensureLocalHost(db);
    assert.deepEqual(listAgents(db).map((a) => [a.agent_id, a.kind]).sort(), [["local", "remote"], ["local-master", "local"]]);
  });

  it("answers every agent call in-process: health (real host name from Podman), containers, details, actions, images, pods", async () => {
    const db = openDb(":memory:");
    ensureLocalHost(db);
    const a = listAgents(db)[0]!;
    const t = targetFor(a.id, db)!;
    const h = await agentHealth(t);
    assert.ok(h.ok && h.data.hostname === "web-host-01" && h.data.podmanVersion === "5.8.2" && h.data.agentStatus === "ok", JSON.stringify(h));
    const list = await agentList(t);
    assert.ok(list.ok && list.data.length === 1 && list.data[0]!.name === "nginx");
    const one = await agentInspect(t, C1);
    assert.ok(one.ok && one.data.id === C1);
    const stop = await agentAction(t, C1, "stop");
    assert.ok(stop.ok, JSON.stringify(stop));
    assert.ok(calls.some((c) => c.startsWith(`POST /libpod/containers/${C1}/stop`)));
    const imgs = await agentImages(t);
    assert.ok(imgs.ok && imgs.data[0]!.containers === 1 && imgs.data[0]!.tags[0] === "docker.io/library/nginx:1");
    const pods = await agentPods(t);
    assert.ok(pods.ok && pods.data.length === 0);
    const bad = await agentInspect(t, "../etc");
    assert.ok(!bad.ok, "ids are validated like at a remote agent");
  });

  it("the heartbeat check stores the host name and versions of the local host; the host appears in the live lists", async () => {
    const db = openDb(":memory:");
    ensureLocalHost(db);
    const id = listAgents(db)[0]!.id;
    const row = await checkAgent(id, db);
    assert.ok(row && row.status === "online" && row.hostname === "web-host-01" && row.podman_version === "5.8.2", JSON.stringify(row));
    const hosts = await fetchAllContainers(db);
    assert.ok(hosts[0]!.result.ok && hosts[0]!.result.data.length === 1);
  });

  it("the agent log of the local host is the master's own log", async () => {
    const db = openDb(":memory:");
    ensureLocalHost(db);
    pushAppLog("info", "master log line for the local host");
    const t = targetFor(listAgents(db)[0]!.id, db)!;
    const logs = await agentAppLogs(t);
    assert.ok(logs.ok && logs.data.lines.some((l) => l.text === "master log line for the local host"));
  });

  it("the master updates itself through the local host (refused outside a container with the reason); the host can be disabled but not removed by the UI", async () => {
    const db = openDb(":memory:");
    ensureLocalHost(db);
    const t = targetFor(listAgents(db)[0]!.id, db)!;
    const info = await agentSelfInfo(t);
    assert.ok(info.ok && info.data.possible === false && info.data.reason === "no_container", JSON.stringify(info));
    const start = await agentUpdateStart(t);
    assert.ok(!start.ok && start.code === "UPDATE_NOT_POSSIBLE");
    assert.equal(getAgent(listAgents(db)[0]!.id, db)?.kind, "local");
    removeAgent(listAgents(db)[0]!.id, db); // the data layer removes; the server action refuses (checked in the browser flow)
  });

  it("a Podman socket that is missing degrades the local host without throwing", async () => {
    const keep = process.env.LOCAL_PODMAN_SOCKET;
    process.env.LOCAL_PODMAN_SOCKET = "/nonexistent/podman.sock";
    try {
      const db = openDb(":memory:");
      ensureLocalHost(db);
      const t = targetFor(listAgents(db)[0]!.id, db)!;
      const h = await agentHealth(t);
      assert.ok(h.ok && h.data.agentStatus === "degraded" && h.data.socketStatus === "missing", JSON.stringify(h));
      const l = await agentList(t);
      assert.ok(!l.ok && l.code === "SOCKET_MISSING");
    } finally {
      process.env.LOCAL_PODMAN_SOCKET = keep;
    }
  });
});
