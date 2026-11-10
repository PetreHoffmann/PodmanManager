import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mapListItem, mapPod, mergeLogs } from "../src/podman/service.js";
import { auth, jsonRes, startAgent, startFakePodman, type Fake, type Running } from "./helpers.js";

const POD = "e".repeat(64);
const INFRA = "1".repeat(64);
const APP = "2".repeat(64);

const rawPod = (status: string) => ({
  Id: POD, Name: "web", Status: status, Created: "2026-11-10T08:00:00.123Z", InfraId: INFRA,
  Containers: [{ Id: INFRA, Names: "abc-infra", Status: "running" }, { Id: APP, Names: "web-app", Status: status === "Running" ? "running" : "exited" }],
});

describe("pod mapping", () => {
  it("maps list entries, lower-cases status, marks the infra container", () => {
    assert.deepEqual(mapPod(rawPod("Degraded")), {
      id: POD, name: "web", status: "degraded", createdAt: "2026-11-10T08:00:00.123Z",
      containers: [{ id: INFRA, name: "abc-infra", state: "running", infra: true }, { id: APP, name: "web-app", state: "exited", infra: false }],
    });
  });
  it("tolerates missing fields and array names", () => {
    const p = mapPod({ Id: POD, Containers: [{ Id: APP, Names: ["/x"] }] });
    assert.equal(p.status, "unknown");
    assert.deepEqual(p.containers, [{ id: APP, name: "x", state: "unknown", infra: false }]);
    assert.deepEqual(mapPod(null).containers, []);
  });
  it("containers carry their pod", () => {
    const c = mapListItem({ Id: APP, Names: ["web-app"], Pod: POD, PodName: "web", State: "running" });
    assert.equal(c.podId, POD);
    assert.equal(c.podName, "web");
    assert.equal(mapListItem({ Id: APP, Names: ["x"], Pod: "" }).podId, null);
  });
});

describe("pod routes", () => {
  let fake: Fake;
  let agent: Running;
  let status = "Running";
  let podStatus = 200;
  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      if (u === "/libpod/pods/json") return jsonRes(res, 200, [rawPod(status)]);
      let m: RegExpExecArray | null;
      if ((m = /^\/libpod\/pods\/([a-f0-9]+)\/(start|stop|restart)/.exec(u))) {
        if (m[1] !== POD) return jsonRes(res, 404, { message: "no such pod" });
        if (podStatus !== 200 && podStatus !== 304) return jsonRes(res, podStatus, { Errs: ["boom one", "boom two"], Id: POD });
        if (podStatus === 200) status = m[2] === "stop" ? "Exited" : "Running";
        return jsonRes(res, podStatus, podStatus === 200 ? { Errs: [], Id: POD } : undefined);
      }
      jsonRes(res, 404, { message: "nope" });
    });
    agent = await startAgent(fake.socketPath);
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });
  const get = (p: string, method = "GET", h: Record<string, string> = auth) => fetch(`${agent.base}/api/v1${p}`, { method, headers: h });

  it("lists and shows pods", async () => {
    const l = (await (await get("/pods")).json()) as { data: { id: string; status: string }[] };
    assert.equal(l.data[0]?.id, POD);
    assert.equal(l.data[0]?.status, "running");
    const d = (await (await get(`/pods/${POD}`)).json()) as { data: { containers: unknown[] } };
    assert.equal(d.data.containers.length, 2);
    assert.equal((await get(`/pods/${POD.slice(0, 12)}`)).status, 200); // short id
  });
  it("starts/stops/restarts with versioned libpod calls", async () => {
    status = "Running";
    const stop = (await (await get(`/pods/${POD}/stop`, "POST")).json()) as { data: { changed: boolean; pod: { status: string } } };
    assert.equal(stop.data.changed, true);
    assert.equal(stop.data.pod.status, "exited");
    assert.ok(fake.calls.some((c) => c === `POST /v4.9.3/libpod/pods/${POD}/stop?t=10`));
    const start = (await (await get(`/pods/${POD}/start`, "POST")).json()) as { data: { pod: { status: string } } };
    assert.equal(start.data.pod.status, "running");
    assert.equal((await get(`/pods/${POD}/restart`, "POST")).status, 200);
  });
  it("304 means nothing changed", async () => {
    podStatus = 304;
    const r = (await (await get(`/pods/${POD}/start`, "POST")).json()) as { data: { changed: boolean } };
    assert.equal(r.data.changed, false);
    podStatus = 200;
  });
  it("reports upstream errors (Errs) and 404", async () => {
    podStatus = 409;
    const r = await get(`/pods/${POD}/start`, "POST");
    assert.equal(r.status, 409);
    assert.match(JSON.stringify(await r.json()), /boom one; boom two/);
    podStatus = 200;
    const nf = await get(`/pods/${"f".repeat(64)}`);
    assert.equal(nf.status, 404);
    assert.equal(((await nf.json()) as { error: { code: string } }).error.code, "POD_NOT_FOUND");
  });
  it("validates ids, methods and auth; no other actions", async () => {
    assert.equal((await get("/pods/not-an-id")).status, 400);
    assert.equal((await get(`/pods/${POD}/start`)).status, 405);
    assert.equal((await get(`/pods/${POD}`, "POST")).status, 405);
    assert.equal((await get("/pods", "POST")).status, 405);
    assert.equal((await get(`/pods/${POD}/rm`, "POST")).status, 404);
    assert.equal((await get(`/pods/${POD}`, "DELETE")).status, 405);
    assert.equal((await get("/pods", "GET", {})).status, 401);
  });
});

function frame(stream: 1 | 2, text: string): Buffer {
  const p = Buffer.from(text, "utf8");
  const h = Buffer.alloc(8);
  h[0] = stream;
  h.writeUInt32BE(p.length, 4);
  return Buffer.concat([h, p]);
}

describe("pod logs", () => {
  const DB = "3".repeat(64);
  const LOGS: Record<string, Buffer> = {
    [APP]: Buffer.concat([frame(1, "2026-11-10T10:00:01Z app one\n"), frame(2, "2026-11-10T10:00:04Z app boom\n"), frame(1, "continuation without time\n")]),
    [DB]: Buffer.concat([frame(1, "2026-11-10T10:00:02Z db two\n"), frame(1, "2026-11-10T10:00:03.5Z db three\n")]),
  };
  let fake: Fake;
  let agent: Running;
  let failDb = false;
  let failApp = false;
  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      if (u === "/libpod/pods/json") {
        return jsonRes(res, 200, [{ Id: POD, Name: "web", Status: "Running", InfraId: INFRA, Containers: [{ Id: INFRA, Names: "x-infra", Status: "running" }, { Id: APP, Names: "web-app", Status: "running" }, { Id: DB, Names: "web-db", Status: "running" }] }]);
      }
      const m = /^\/libpod\/containers\/([a-f0-9]+)\/logs\?/.exec(u);
      if (m) {
        if ((m[1] === DB && failDb) || (m[1] === APP && failApp)) return jsonRes(res, 500, { message: "this container is using the 'none' log driver" });
        res.writeHead(200);
        return void res.end(LOGS[m[1]!] ?? Buffer.alloc(0));
      }
      jsonRes(res, 404, { message: "nope" });
    });
    agent = await startAgent(fake.socketPath);
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });
  const get = (p: string) => fetch(`${agent.base}/api/v1${p}`, { headers: auth });

  it("merges the logs of all containers by time and labels each line; infra container is not read", async () => {
    const r = (await (await get(`/pods/${POD}/logs`)).json()) as { data: { tail: number; skipped: string[]; lines: { container: string; text: string; stream: string }[] } };
    assert.deepEqual(r.data.lines.map((l) => `${l.container}:${l.text}`), ["web-app:app one", "web-db:db two", "web-db:db three", "web-app:app boom", "web-app:continuation without time"]);
    assert.equal(r.data.lines[3]?.stream, "stderr");
    assert.deepEqual(r.data.skipped, []);
    assert.ok(!fake.calls.some((c) => c.includes(`/containers/${INFRA}/logs`)));
  });
  it("keeps only the newest `tail` lines of the merged result", async () => {
    const r = (await (await get(`/pods/${POD}/logs?tail=2`)).json()) as { data: { lines: { text: string }[] } };
    assert.deepEqual(r.data.lines.map((l) => l.text), ["app boom", "continuation without time"]);
    assert.ok(fake.calls.some((c) => c.includes(`/containers/${DB}/logs?`) && c.includes("tail=2")));
  });
  it("skips containers whose logs are unreadable; fails when none is readable", async () => {
    failDb = true;
    const r = (await (await get(`/pods/${POD}/logs`)).json()) as { data: { skipped: string[]; lines: { container: string }[] } };
    assert.deepEqual(r.data.skipped, ["web-db"]);
    assert.ok(r.data.lines.every((l) => l.container === "web-app"));
    failApp = true;
    assert.equal((await get(`/pods/${POD}/logs`)).status, 502);
    failDb = false;
    failApp = false;
  });
  it("validates tail, pod id, method and auth; unknown pod is 404", async () => {
    for (const q of ["0", "501", "abc"]) assert.equal((await get(`/pods/${POD}/logs?tail=${q}`)).status, 400, q);
    assert.equal((await get(`/pods/zzz/logs`)).status, 400);
    assert.equal((await get(`/pods/${"f".repeat(64)}/logs`)).status, 404);
    assert.equal((await fetch(`${agent.base}/api/v1/pods/${POD}/logs`, { method: "POST", headers: auth })).status, 405);
    assert.equal((await fetch(`${agent.base}/api/v1/pods/${POD}/logs`)).status, 401);
  });
});

describe("mergeLogs", () => {
  it("is stable for equal times and handles lines without timestamps", () => {
    const l = (ts: string | null, text: string) => ({ ts, stream: "stdout" as const, text });
    const out = mergeLogs([{ name: "a", lines: [l("2026-11-10T10:00:00Z", "a1"), l(null, "a2")] }, { name: "b", lines: [l("2026-11-10T10:00:00Z", "b1")] }], 10);
    assert.deepEqual(out.map((x) => `${x.container}:${x.text}`), ["a:a1", "a:a2", "b:b1"]);
  });
});
