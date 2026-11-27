import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPod } from "../src/podman/service.js";
import { auth, jsonRes, startAgent, startFakePodman } from "./helpers.js";

const POD = "a".repeat(64), INFRA = "b".repeat(64), APP = "c".repeat(64), DB = "d".repeat(64);
const pod = (status: string, labels: Record<string, string> = {}) => ({
  Id: POD, Name: "shop", Status: status, Created: "2026-11-10T08:00:00Z", InfraId: INFRA, Labels: labels,
  Containers: [{ Id: INFRA, Names: "abc-infra", Status: "exited" }, { Id: APP, Names: "shop-app", Status: status === "Running" ? "running" : "exited" }, { Id: DB, Names: "shop-db", Status: "exited" }],
});

describe("pod systemd label", () => {
  it("is read from the pod", () => {
    assert.equal(mapPod(pod("Exited", { PODMAN_SYSTEMD_UNIT: "shop-pod.service" })).systemdUnit, "shop-pod.service");
    assert.equal(mapPod(pod("Exited")).systemdUnit, null);
  });
});

describe("delete pod", () => {
  const seen: string[] = [];
  const run = async (opts: { status?: string; podLabels?: Record<string, string>; memberLabel?: boolean; delStatus?: number }, f: (del: (id?: string) => Promise<Response>, get: (p: string) => Promise<Response>) => Promise<void>) => {
    seen.length = 0;
    const fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      seen.push(`${req.method} ${u}`);
      if (u === "/libpod/pods/json") return jsonRes(res, 200, [pod(opts.status ?? "Exited", opts.podLabels ?? {})]);
      if (u === "/libpod/containers/json?all=true") return jsonRes(res, 200, [
        { Id: APP, Names: ["shop-app"], State: "exited", Pod: POD, Labels: opts.memberLabel ? { PODMAN_SYSTEMD_UNIT: "app.service" } : {} },
        { Id: DB, Names: ["shop-db"], State: "exited", Pod: POD, Labels: {} }]);
      if (req.method === "DELETE" && u === `/libpod/pods/${POD}?force=false`) return opts.delStatus === 409 ? jsonRes(res, 409, { message: "running" }) : jsonRes(res, 200, { Id: POD });
      jsonRes(res, 404, { message: "nope" });
    });
    const agent = await startAgent(fake.socketPath, { rateLimitMax: 1000 });
    try { await f((id = POD) => fetch(`${agent.base}/api/v1/pods/${id}`, { method: "DELETE", headers: auth }), (p) => fetch(agent.base + p, { headers: auth })); }
    finally { await agent.close(); await fake.close(); }
  };
  const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

  it("removes a stopped pod without systemd: no force, the containers are named", async () => {
    await run({}, async (del) => {
      const r = await del();
      assert.equal(r.status, 200);
      assert.deepEqual(((await r.json()) as { data: unknown }).data, { id: POD, name: "shop", containers: ["shop-app", "shop-db"] });
      assert.ok(seen.includes(`DELETE /libpod/pods/${POD}?force=false`));
    });
  });
  it("a pod without containers is deletable", async () => {
    await run({ status: "Created" }, async (del) => assert.equal((await del()).status, 200));
  });
  it("refuses a systemd-managed pod, a pod with a systemd-managed container and running pods without calling DELETE", async () => {
    for (const [o, c, st] of [[{ podLabels: { PODMAN_SYSTEMD_UNIT: "shop-pod.service" } }, "MANAGED_BY_SYSTEMD", 409], [{ memberLabel: true }, "MANAGED_BY_SYSTEMD", 409], [{ status: "Running" }, "POD_RUNNING", 409], [{ status: "Degraded" }, "POD_RUNNING", 409]] as const) {
      await run(o, async (del) => {
        const r = await del();
        assert.equal(r.status, st);
        assert.equal(await code(r), c);
        assert.ok(!seen.some((s) => s.startsWith("DELETE")), "no delete call");
      });
    }
  });
  it("lists the unit of a container as the pod's systemdUnit", async () => {
    await run({ memberLabel: true }, async (_d, get) => {
      const b = (await (await get("/api/v1/pods")).json()) as { data: { systemdUnit: string | null }[] };
      assert.equal(b.data[0]!.systemdUnit, "app.service");
    });
  });
  it("unknown pod is 404, bad id 400, no token 401", async () => {
    await run({}, async (del) => {
      assert.equal((await del("f".repeat(64))).status, 404);
      assert.equal((await del("web")).status, 400);
    });
    const fake = await startFakePodman((_q, res) => jsonRes(res, 404, {}));
    const agent = await startAgent(fake.socketPath, { rateLimitMax: 1000 });
    try { assert.equal((await fetch(`${agent.base}/api/v1/pods/${POD}`, { method: "DELETE" })).status, 401); }
    finally { await agent.close(); await fake.close(); }
  });
});
