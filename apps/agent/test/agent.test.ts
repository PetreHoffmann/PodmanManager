import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { FailureLimiter, extractBearer, hashToken, verifyToken } from "../src/auth/auth.js";
import { loadConfig } from "../src/config/config.js";
import { isValidContainerId } from "../src/podman/service.js";
import { ID, TOKEN, auth, jsonRes, startAgent, startFakePodman } from "./helpers.js";

const inspectBody = {
  Id: ID,
  Name: "web",
  ImageName: "docker.io/library/nginx:latest",
  Created: "2025-01-01T10:00:00Z",
  State: { Status: "running", StartedAt: "2025-01-02T10:00:00Z" },
};

describe("auth", () => {
  it("verifies matching token only", () => {
    const h = hashToken(TOKEN);
    assert.equal(verifyToken(`Bearer ${TOKEN}`, h), true);
    assert.equal(verifyToken(`Bearer ${TOKEN}x`, h), false);
    assert.equal(verifyToken(undefined, h), false);
    assert.equal(verifyToken(`Basic ${TOKEN}`, h), false);
    assert.equal(extractBearer("Bearer short"), null);
  });
  it("limiter blocks after max failures and expires", () => {
    let t = 0;
    const l = new FailureLimiter(2, 1000, () => t);
    l.recordFailure("ip");
    assert.equal(l.isBlocked("ip"), false);
    l.recordFailure("ip");
    assert.equal(l.isBlocked("ip"), true);
    t = 1500;
    assert.equal(l.isBlocked("ip"), false);
  });
});

describe("config", () => {
  const base = { AGENT_ID: "a1", AGENT_TOKEN_HASH: "0".repeat(64), XDG_RUNTIME_DIR: "/run/user/1000" };
  it("defaults to XDG socket and port 9126", () => {
    const c = loadConfig(base);
    assert.equal(c.podmanSocket, "/run/user/1000/podman/podman.sock");
    assert.equal(c.port, 9126);
    assert.equal(c.host, "0.0.0.0");
  });
  it("rejects bad values", () => {
    assert.throws(() => loadConfig({ ...base, AGENT_ID: "" }));
    assert.throws(() => loadConfig({ ...base, AGENT_TOKEN_HASH: "x" }));
    assert.throws(() => loadConfig({ ...base, AGENT_PORT: "99999" }));
    assert.throws(() => loadConfig({ ...base, PODMAN_SOCKET: "relative.sock" }));
  });
});

describe("container id validation", () => {
  it("accepts hex ids, rejects the rest", () => {
    assert.equal(isValidContainerId(ID), true);
    assert.equal(isValidContainerId("abc123abc123"), true);
    for (const bad of ["", "web", "../etc", "a".repeat(65), "abc", "ABCDEF123456", "a".repeat(12) + "/start"]) {
      assert.equal(isValidContainerId(bad), false, bad);
    }
  });
});

describe("agent API with podman socket", () => {
  const state = { stopped: false };
  const fakeP = startFakePodman((req, res) => {
    const url = req.url ?? "";
    if (url === "/libpod/_ping") return jsonRes(res, 200, "OK");
    if (url === "/libpod/version") return jsonRes(res, 200, { Version: "5.2.0", ApiVersion: "5.2.0" });
    if (url === "/libpod/containers/json?all=true") {
      return jsonRes(res, 200, [
        { Id: ID, Names: ["web"], Image: "nginx", State: "running", Status: "Up 1 hour", Created: "2025-01-01T10:00:00Z", StartedAt: 1735812000 },
        { Id: "b".repeat(64), Names: ["db"], Image: "pg", State: "exited", Created: "2025-01-01T10:00:00Z", StartedAt: 0 },
      ]);
    }
    if (url === `/libpod/containers/${ID}/json`) {
      return jsonRes(res, 200, { ...inspectBody, State: { ...inspectBody.State, Status: state.stopped ? "exited" : "running" } });
    }
    if (url === `/libpod/containers/${ID}/stop?timeout=10`) {
      state.stopped = true;
      return jsonRes(res, 204);
    }
    if (url === `/libpod/containers/${ID}/start`) {
      if (!state.stopped) return jsonRes(res, 304);
      state.stopped = false;
      return jsonRes(res, 204);
    }
    if (url === `/libpod/containers/${ID}/restart?t=10`) return jsonRes(res, 204);
    if (url.startsWith(`/libpod/containers/${"c".repeat(64)}`)) return jsonRes(res, 404, { cause: "no such container", message: "no such container", response: 404 });
    if (url === `/libpod/containers/${"d".repeat(64)}/start`) return jsonRes(res, 500, { message: "crun: boom", cause: "x", response: 500 });
    jsonRes(res, 404, { message: "nope" });
  });
  let fake: Awaited<typeof fakeP>;
  let agent: Awaited<ReturnType<typeof startAgent>>;
  const ready = (async () => {
    fake = await fakeP;
    agent = await startAgent(fake.socketPath, { rateLimitMax: 1000 });
  })();
  after(async () => {
    await agent.close();
    await fake.close();
  });

  const get = async (p: string, headers: Record<string, string> = auth) => {
    await ready;
    return fetch(agent.base + p, { headers });
  };
  const post = async (p: string, headers: Record<string, string> = auth) => {
    await ready;
    return fetch(agent.base + p, { method: "POST", headers });
  };

  it("health reports ok with versions", async () => {
    const r = await get("/api/v1/health");
    assert.equal(r.status, 200);
    const b = (await r.json()) as any;
    assert.equal(b.ok, true);
    assert.equal(b.data.podmanVersion, "5.2.0");
    assert.equal(b.data.socketStatus, "ok");
    assert.equal(b.data.apiStatus, "ok");
    assert.equal(b.data.agentStatus, "ok");
    assert.equal(b.data.agentId, "test-agent");
  });

  it("lists containers with normalized fields", async () => {
    const b = (await (await get("/api/v1/containers")).json()) as any;
    assert.equal(b.data.length, 2);
    assert.equal(b.data[0].name, "web");
    assert.equal(b.data[0].startedAt, "2025-01-02T10:00:00.000Z");
    assert.equal(b.data[1].startedAt, null);
    assert.equal(b.data[1].status, "exited");
  });

  it("returns details", async () => {
    const b = (await (await get(`/api/v1/containers/${ID}`)).json()) as any;
    assert.equal(b.data.image, "docker.io/library/nginx:latest");
    assert.equal(b.data.state, "running");
  });

  it("stop, start, restart work and return fresh state", async () => {
    let b = (await (await post(`/api/v1/containers/${ID}/stop`)).json()) as any;
    assert.equal(b.data.changed, true);
    assert.equal(b.data.container.state, "exited");
    b = (await (await post(`/api/v1/containers/${ID}/start`)).json()) as any;
    assert.equal(b.data.container.state, "running");
    b = (await (await post(`/api/v1/containers/${ID}/start`)).json()) as any;
    assert.equal(b.data.changed, false);
    b = (await (await post(`/api/v1/containers/${ID}/restart`)).json()) as any;
    assert.equal(b.data.action, "restart");
  });

  it("maps unknown container to 404", async () => {
    const r = await post(`/api/v1/containers/${"c".repeat(64)}/start`);
    assert.equal(r.status, 404);
    assert.equal(((await r.json()) as any).error.code, "CONTAINER_NOT_FOUND");
  });

  it("maps podman failure to 502 with message", async () => {
    const r = await post(`/api/v1/containers/${"d".repeat(64)}/start`);
    assert.equal(r.status, 502);
    assert.equal(((await r.json()) as any).error.code, "PODMAN_API_ERROR");
  });

  it("rejects invalid ids without calling podman", async () => {
    await ready;
    const before = fake.calls.length;
    for (const bad of ["web", "..%2F..%2Finfo", "ZZZ", "a".repeat(70)]) {
      const r = await post(`/api/v1/containers/${bad}/stop`);
      assert.equal(r.status, 400, bad);
    }
    assert.equal(fake.calls.length, before);
  });

  it("allows only defined routes and methods", async () => {
    assert.equal((await post(`/api/v1/containers/${ID}/delete`)).status, 404);
    assert.equal((await post(`/api/v1/containers/${ID}/exec`)).status, 404);
    assert.equal((await get(`/api/v1/containers/${ID}/start`)).status, 405);
    assert.equal((await post(`/api/v1/containers`)).status, 405);
    assert.equal((await get(`/api/v1/images`)).status, 404);
    assert.equal((await get(`/libpod/info`)).status, 404);
  });

  it("requires authentication on every endpoint", async () => {
    for (const p of ["/api/v1/health", "/api/v1/containers", `/api/v1/containers/${ID}`]) {
      assert.equal((await get(p, {})).status, 401, p);
      assert.equal((await get(p, { Authorization: "Bearer wrong-token-0123456789" })).status, 401, p);
    }
    assert.equal((await post(`/api/v1/containers/${ID}/stop`, {})).status, 401);
  });
});

describe("failure handling", () => {
  it("reports missing socket in health and 503 on operations", async () => {
    const agent = await startAgent("/nonexistent/podman.sock");
    try {
      const h = (await (await fetch(agent.base + "/api/v1/health", { headers: auth })).json()) as any;
      assert.equal(h.ok, true);
      assert.equal(h.data.socketStatus, "missing");
      assert.equal(h.data.agentStatus, "degraded");
      assert.equal(h.data.error.code, "SOCKET_MISSING");
      const r = await fetch(agent.base + "/api/v1/containers", { headers: auth });
      assert.equal(r.status, 503);
      assert.equal(((await r.json()) as any).error.code, "SOCKET_MISSING");
      const s = await fetch(agent.base + `/api/v1/containers/${ID}/stop`, { method: "POST", headers: auth });
      assert.equal(s.status, 503);
    } finally {
      await agent.close();
    }
  });

  it("reports unreachable API when socket path is not served", async () => {
    const fake = await startFakePodman((_q, res) => jsonRes(res, 500, { message: "broken" }));
    const agent = await startAgent(fake.socketPath);
    try {
      const h = (await (await fetch(agent.base + "/api/v1/health", { headers: auth })).json()) as any;
      assert.equal(h.data.apiStatus, "error");
      assert.equal(h.data.agentStatus, "degraded");
    } finally {
      await agent.close();
      await fake.close();
    }
  });

  it("times out on hanging podman", async () => {
    const fake = await startFakePodman(() => {});
    const agent = await startAgent(fake.socketPath, { podmanTimeoutMs: 300 });
    try {
      const r = await fetch(agent.base + "/api/v1/containers", { headers: auth });
      assert.equal(r.status, 504);
    } finally {
      fake.server.closeAllConnections();
      await agent.close();
      await fake.close();
    }
  });

  it("rate limits repeated auth failures", async () => {
    const agent = await startAgent("/nonexistent/podman.sock", { rateLimitMax: 3 });
    try {
      for (let i = 0; i < 3; i++) {
        assert.equal((await fetch(agent.base + "/api/v1/health")).status, 401);
      }
      assert.equal((await fetch(agent.base + "/api/v1/health")).status, 429);
      assert.equal((await fetch(agent.base + "/api/v1/health", { headers: auth })).status, 429);
    } finally {
      await agent.close();
    }
  });
});
