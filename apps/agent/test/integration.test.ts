import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PodmanClient } from "../src/podman/client.js";
import { PodmanService } from "../src/podman/service.js";

const sock = process.env.PODMAN_SOCKET ?? (process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, "podman", "podman.sock") : "");
const available = sock !== "" && existsSync(sock);

// Runs only against a real rootless Podman socket; skipped otherwise (never simulated).
describe("real podman socket", { skip: available ? false : "no rootless podman socket available" }, () => {
  const svc = new PodmanService(new PodmanClient(sock, 10000), 10);
  it("ping, version and list work", async () => {
    await svc.ping();
    const v = await svc.version();
    assert.ok(v.version);
    const list = await svc.list();
    assert.ok(Array.isArray(list));
    for (const c of list) assert.match(c.id, /^[a-f0-9]{64}$/);
  });
  it("inspect round-trips the first container", async (t) => {
    const first = (await svc.list())[0];
    if (!first) return t.skip("no containers present");
    const d = await svc.inspect(first.id);
    assert.equal(d.id, first.id);
  });
});
