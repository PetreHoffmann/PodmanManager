import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCreateRequest } from "@agent/podman/create";
import { startAgent, startFakePodman, jsonRes, TOKEN } from "../../agent/test/helpers.js";
import { agentCreateContainer, agentImagePull } from "../src/lib/agent-client";

const NEW = "e".repeat(64);

describe("create container through a real agent", () => {
  it("pulls, creates and starts; env values reach podman, rejects unsafe requests", async () => {
    const seen: { url: string; body: string }[] = [];
    const fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: u, body });
        if (u.startsWith("/libpod/images/pull?")) return jsonRes(res, 200, { id: "f".repeat(64), images: ["f".repeat(64)] });
        if (u === "/libpod/containers/create") return jsonRes(res, 201, { Id: NEW, Warnings: [] });
        if (u === `/libpod/containers/${NEW}/start`) return jsonRes(res, 204);
        jsonRes(res, 404, { message: "nope" });
      });
    });
    const agent = await startAgent(fake.socketPath, {});
    try {
      const target = { address: "127.0.0.1", port: Number(new URL(agent.base).port), token: TOKEN };
      const pulled = await agentImagePull(target, "docker.io/library/nginx:latest");
      assert.equal(pulled.ok, true);
      const parsed = parseCreateRequest({
        name: "web", image: "docker.io/library/nginx:latest", ports: [{ host: 8081, container: 80, protocol: "tcp" }],
        env: [{ key: "A", value: "b c" }], volumes: [{ name: "data", path: "/data", readOnly: false }], restart: "always", memoryMb: 256, command: ["nginx", "-g", "daemon off;"],
      });
      assert.equal(parsed.ok, true);
      const r = await agentCreateContainer(target, parsed.ok ? parsed.req : null);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.data.id, NEW);
      const create = seen.find((s) => s.url === "/libpod/containers/create");
      assert.ok(create && /"privileged":false/.test(create.body) && create.body.includes("b c"));
      assert.ok(seen.some((s) => s.url === `/libpod/containers/${NEW}/start`));
      const before = seen.length;
      const bad = await agentCreateContainer(target, { name: "x", image: "nginx", privileged: true });
      assert.equal(bad.ok, false);
      const hostPath = await agentCreateContainer(target, { name: "x", image: "nginx", volumes: [{ name: "/etc", path: "/data" }] });
      assert.equal(hostPath.ok, false);
      assert.equal(seen.length, before, "invalid requests never reach podman");
    } finally {
      await agent.close();
      await fake.close();
    }
  });
});
