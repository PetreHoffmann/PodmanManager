import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PodmanClient } from "../src/podman/client.js";
import { PodmanService } from "../src/podman/service.js";
import { jsonRes, startFakePodman } from "./helpers.js";

const inspectBody = { Id: "", Name: "systemd-youtrack-container", ImageName: "docker.io/jetbrains/youtrack:latest", Created: "2025-01-01T10:00:00Z", State: { Status: "running", StartedAt: "2025-01-02T10:00:00Z" }, Config: {}, HostConfig: {} };

const OLD = "a".repeat(64), NEW = "b".repeat(64);
const quadlet = (id: string, running: boolean) => ({
  ...inspectBody,
  Id: id,
  Config: { ...inspectBody.Config, Labels: { PODMAN_SYSTEMD_UNIT: "youtrack-container.service" } },
  HostConfig: { ...inspectBody.HostConfig, AutoRemove: true },
  State: { ...inspectBody.State, Status: running ? "running" : "exited" },
});

function setup(systemdStarts: boolean) {
  const calls: string[] = [];
  const st = { stopped: false };
  const fake = startFakePodman((req, res) => {
    const url = req.url ?? "";
    calls.push(`${req.method} ${url}`);
    if (url === "/libpod/_ping") return jsonRes(res, 200, "OK");
    if (url === `/libpod/containers/${OLD}/json`) return jsonRes(res, 200, quadlet(OLD, !st.stopped));
    if (url === `/libpod/containers/${NEW}/json`) return jsonRes(res, 200, quadlet(NEW, true));
    if (url === `/libpod/containers/${OLD}/stop?timeout=10`) { st.stopped = true; return jsonRes(res, 204); }
    if (url.startsWith("/libpod/containers/json?filters=")) {
      const f = JSON.parse(decodeURIComponent(url.split("filters=")[1]!));
      assert.deepEqual(f, { label: ["PODMAN_SYSTEMD_UNIT=youtrack-container.service"], status: ["running"] });
      return jsonRes(res, 200, st.stopped && systemdStarts ? [{ Id: NEW }] : []);
    }
    if (url.includes("/restart")) return jsonRes(res, 500, { message: "pasta failed: Address already in use" });
    jsonRes(res, 404, { message: "nope" });
  });
  return { fake, calls };
}

describe("restart of a Quadlet (systemd, --rm) container", () => {
  it("stops it and waits for systemd to bring the unit back, never calls the Podman restart", async () => {
    const { fake, calls } = setup(true);
    const f = await fake;
    try {
      const svc = new PodmanService(new PodmanClient(f.socketPath, 2000), 10, 3000);
      const r = await svc.act(OLD, "restart");
      assert.equal(r.changed, true);
      assert.equal(r.container.id, NEW);
      assert.equal(calls.some((c) => c.includes("/restart")), false);
    } finally { await f.close(); }
  });

  it("reports SYSTEMD_NOT_RESTARTED when the unit does not come back", async () => {
    const { fake } = setup(false);
    const f = await fake;
    try {
      const svc = new PodmanService(new PodmanClient(f.socketPath, 2000), 10, 600);
      await assert.rejects(svc.act(OLD, "restart"), (e: { code?: string }) => e.code === "SYSTEMD_NOT_RESTARTED");
    } finally { await f.close(); }
  });
});
