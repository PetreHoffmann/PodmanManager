import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapContainerConfig } from "../src/podman/config.js";
import { ID, auth, jsonRes, startAgent, startFakePodman } from "./helpers.js";

const raw = {
  Id: ID, Name: "web", ImageName: "docker.io/library/nginx:latest", Image: "1".repeat(64),
  Config: { Env: ["PATH=/usr/bin", "NGINX_VERSION=1", "container=podman", "HOSTNAME=abc", "TZ=Europe/Berlin", "PW=a=b c", "https_proxy=http://p:1", "NO_PROXY=x"], Cmd: ["nginx", "-g", "daemon off;"] },
  HostConfig: { PortBindings: { "80/tcp": [{ HostIp: "", HostPort: "8081" }], "53/udp": [{ HostIp: "", HostPort: "5353" }], "9/tcp": [{ HostPort: "" }] }, RestartPolicy: { Name: "unless-stopped" }, Memory: 268435456 },
  Mounts: [{ Type: "volume", Name: "data", Destination: "/data", RW: false }, { Type: "bind", Source: "/secret/host/path", Destination: "/x", RW: true }],
  NetworkSettings: { Networks: { appnet: {} } },
};
const image = { Config: { Env: ["PATH=/usr/bin", "NGINX_VERSION=1"], Cmd: ["nginx", "-g", "daemon off;"] } };

describe("container config", () => {
  it("rebuilds the form fields and drops what the image or Podman set", () => {
    const c = mapContainerConfig(raw, image);
    assert.deepEqual(c, {
      name: "web", image: "docker.io/library/nginx:latest",
      ports: [{ host: 8081, container: 80, protocol: "tcp" }, { host: 5353, container: 53, protocol: "udp" }],
      env: [{ key: "TZ", value: "Europe/Berlin" }, { key: "PW", value: "a=b c" }],
      volumes: [{ name: "data", path: "/data", readOnly: true }], network: "appnet", pod: null, restart: "unless-stopped", memoryMb: 256, command: [], bindMounts: 1,
    });
  });
  it("without the image everything is listed, a changed command is kept", () => {
    const c = mapContainerConfig({ ...raw, Config: { ...raw.Config, Cmd: ["sleep", "1"] } });
    assert.equal(c.env.length, 4);
    assert.deepEqual(c.command, ["sleep", "1"]);
  });
  it("in a pod there are no ports or network; the host path of a bind mount never appears", () => {
    const c = mapContainerConfig({ ...raw, PodName: "app" }, image);
    assert.equal(c.pod, "app");
    assert.deepEqual([c.ports, c.network], [[], null]);
    assert.ok(!JSON.stringify(c).includes("/secret/host/path"));
  });
  it("is robust against empty or odd input", () => {
    const c = mapContainerConfig(null);
    assert.deepEqual([c.name, c.ports, c.env, c.volumes, c.restart, c.memoryMb], ["", [], [], [], "no", null]);
  });
});

describe("config route", () => {
  it("serves the config read-only", async () => {
    const fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      if (u === `/libpod/containers/${ID}/json`) return jsonRes(res, 200, raw);
      if (u === `/libpod/images/${"1".repeat(64)}/json`) return jsonRes(res, 200, image);
      jsonRes(res, 404, { message: "nope" });
    });
    const agent = await startAgent(fake.socketPath, { rateLimitMax: 1000 });
    try {
      const r = await fetch(`${agent.base}/api/v1/containers/${ID}/config`, { headers: auth });
      assert.equal(r.status, 200);
      const b = (await r.json()) as { data: { env: unknown[]; bindMounts: number } };
      assert.equal(b.data.env.length, 2);
      assert.equal(b.data.bindMounts, 1);
      assert.equal((await fetch(`${agent.base}/api/v1/containers/${ID}/config`, { method: "POST", headers: auth })).status, 405);
      assert.equal((await fetch(`${agent.base}/api/v1/containers/${ID}/config`)).status, 401);
    } finally { await agent.close(); await fake.close(); }
  });
});
