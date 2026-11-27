import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapInspect, mapListItem } from "../src/podman/service.js";
import { ID, auth, jsonRes, startAgent, startFakePodman } from "./helpers.js";

describe("systemd label", () => {
  it("is read from the list and from the inspect", () => {
    assert.equal(mapListItem({ Id: ID, Names: ["a"], Labels: { PODMAN_SYSTEMD_UNIT: "web.service" } }).systemdUnit, "web.service");
    assert.equal(mapListItem({ Id: ID, Names: ["a"], Labels: {} }).systemdUnit, null);
    assert.equal(mapListItem({ Id: ID, Names: ["a"] }).systemdUnit, null);
    assert.equal(mapListItem({ Id: ID, Names: ["a"], IsInfra: true }).infra, true);
    assert.equal(mapInspect({ Id: ID, Name: "a", Config: { Labels: { PODMAN_SYSTEMD_UNIT: "web.service" } } }).systemdUnit, "web.service");
    assert.equal(mapInspect({ Id: ID, Name: "a", Config: { Labels: {} } }).systemdUnit, null);
  });
});

describe("delete container", () => {
  const seen: string[] = [];
  let kind: "ok" | "systemd" | "running" | "infra" | "gone" | "inuse" = "ok";
  const start = () => startFakePodman((req, res) => {
    const u = req.url ?? "";
    seen.push(`${req.method} ${u}`);
    if (req.method === "GET" && u === `/libpod/containers/${ID}/json`) {
      if (kind === "gone") return jsonRes(res, 404, { message: "no such container" });
      return jsonRes(res, 200, {
        Id: ID, Name: "web", ImageName: "docker.io/library/nginx:latest", IsInfra: kind === "infra",
        State: { Status: kind === "running" ? "running" : "exited" },
        Config: { Labels: kind === "systemd" ? { PODMAN_SYSTEMD_UNIT: "web.service" } : {} },
      });
    }
    if (req.method === "DELETE" && u === `/libpod/containers/${ID}?force=false&v=false`) return kind === "inuse" ? jsonRes(res, 409, { message: "in use" }) : jsonRes(res, 200, [{ Id: ID }]);
    jsonRes(res, 404, { message: "nope" });
  });
  const run = async (f: (del: () => Promise<Response>) => Promise<void>) => {
    seen.length = 0;
    const fake = await start();
    const agent = await startAgent(fake.socketPath, { rateLimitMax: 1000 });
    try { await f(() => fetch(`${agent.base}/api/v1/containers/${ID}`, { method: "DELETE", headers: auth })); }
    finally { await agent.close(); await fake.close(); }
  };
  const del = (k: typeof kind) => run(async (d) => { kind = k; const r = await d(); assert.equal(r.status, k === "gone" ? 404 : k === "ok" ? 200 : 409, k); });

  it("removes a stopped container that systemd does not manage: no force, volumes are kept", async () => {
    kind = "ok";
    await run(async (d) => {
      const r = await d();
      assert.equal(r.status, 200);
      assert.deepEqual(((await r.json()) as { data: unknown }).data, { id: ID, name: "web", image: "docker.io/library/nginx:latest" });
      assert.ok(seen.includes(`DELETE /libpod/containers/${ID}?force=false&v=false`));
    });
  });
  it("refuses systemd-managed, running and infra containers without calling DELETE", async () => {
    for (const [k, code] of [["systemd", "MANAGED_BY_SYSTEMD"], ["running", "CONTAINER_RUNNING"], ["infra", "CONTAINER_PROTECTED"]] as const) {
      kind = k;
      await run(async (d) => {
        const r = await d();
        assert.equal(r.status, 409, k);
        assert.equal(((await r.json()) as { error: { code: string } }).error.code, code);
        assert.ok(!seen.some((s) => s.startsWith("DELETE")), `${k}: no delete call`);
      });
    }
  });
  it("unknown container is 404, a container that is in use stays 409", async () => {
    await del("gone");
    await del("inuse");
    kind = "ok";
  });
  it("needs a valid id and the token", async () => {
    kind = "ok";
    const fake = await start();
    const agent = await startAgent(fake.socketPath, { rateLimitMax: 1000 });
    try {
      assert.equal((await fetch(`${agent.base}/api/v1/containers/web`, { method: "DELETE", headers: auth })).status, 400);
      assert.equal((await fetch(`${agent.base}/api/v1/containers/${ID}`, { method: "DELETE" })).status, 401);
    } finally { await agent.close(); await fake.close(); }
  });
});
