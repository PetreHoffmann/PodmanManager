import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { libpodSpec, parseCreateRequest } from "../src/podman/create.js";
import { auth, jsonRes, startAgent, startFakePodman, type Fake, type Running } from "./helpers.js";

const ok = (input: unknown) => {
  const r = parseCreateRequest(input);
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; req: ReturnType<typeof Object> }).req as never as import("../src/podman/create.js").CreateRequest;
};
const bad = (input: unknown, re: RegExp) => {
  const r = parseCreateRequest(input);
  assert.equal(r.ok, false, JSON.stringify(input));
  assert.match((r as { ok: false; message: string }).message, re);
};
const base = { name: "web", image: "docker.io/library/nginx:latest" };

describe("create request validation", () => {
  it("accepts a minimal request and fills the defaults", () => {
    const r = ok(base);
    assert.deepEqual(r, { name: "web", image: "docker.io/library/nginx:latest", ports: [], env: [], volumes: [], network: null, pod: null, restart: "no", memoryMb: null, command: [] });
  });
  it("accepts ports, env, named volumes, network, restart, memory and command", () => {
    const r = ok({ ...base, ports: [{ host: 8080, container: 80 }, { host: 5353, container: 53, protocol: "udp" }], env: [{ key: "A_B", value: "x y" }], volumes: [{ name: "data", path: "/var/lib/data", readOnly: true }], network: "app-net", restart: "unless-stopped", memoryMb: 512, command: ["nginx", "-g", "daemon off;"] });
    assert.equal(r.ports[0]!.protocol, "tcp");
    assert.equal(r.volumes[0]!.readOnly, true);
    assert.equal(r.restart, "unless-stopped");
  });
  it("rejects unknown fields (so that nothing like privileged can be smuggled in)", () => {
    for (const f of ["privileged", "cap_add", "userns", "pid", "mounts", "user", "x_unused"]) bad({ ...base, [f]: true }, /Unknown field/);
  });
  it("rejects bad names, images and non-objects", () => {
    bad(null, /object/); bad([], /object/); bad("x", /object/);
    for (const n of ["", "-x", "a b", "a/b", "x".repeat(65), "../x", 5]) bad({ ...base, name: n }, /container name/);
    for (const i of ["", "-x", "nginx latest", "nginx;rm", "x".repeat(256), "$(id)", 5]) bad({ ...base, image: i }, /image/);
  });
  it("rejects host paths, escapes and dangerous mount points", () => {
    for (const n of ["/etc", "./x", "../x", "a/b", "~/x", ""]) bad({ ...base, volumes: [{ name: n, path: "/data" }] }, /volume name/);
    for (const p of ["data", "/", "/a/../b", "/a b", "/proc", "/sys/x", "/dev"]) bad({ ...base, volumes: [{ name: "v", path: p }] }, /path|not allowed/i);
    bad({ ...base, volumes: [{ name: "a", path: "/d" }, { name: "b", path: "/d" }] }, /twice/);
  });
  it("rejects host and special networks", () => {
    for (const n of ["host", "none", "container", "pasta", "slirp4netns", "bridge", "a b", "../x"]) bad({ ...base, network: n }, /network/i);
  });
  it("rejects invalid ports, env, restart, memory and command", () => {
    bad({ ...base, ports: [{ host: 0, container: 80 }] }, /1 to 65535/);
    bad({ ...base, ports: [{ host: 70000, container: 80 }] }, /1 to 65535/);
    bad({ ...base, ports: [{ host: 80, container: 80, protocol: "icmp" }] }, /tcp or udp/);
    bad({ ...base, ports: [{ host: 80, container: 80 }, { host: 80, container: 81 }] }, /twice/);
    bad({ ...base, env: [{ key: "1A", value: "x" }] }, /environment variable name/);
    bad({ ...base, env: [{ key: "A", value: "x" }, { key: "A", value: "y" }] }, /twice/);
    bad({ ...base, env: [{ key: "A", value: "x\0y" }] }, /NUL/);
    bad({ ...base, restart: "sometimes" }, /restart/);
    bad({ ...base, memoryMb: 1 }, /Memory/);
    bad({ ...base, memoryMb: 1.5 }, /Memory/);
    bad({ ...base, command: [""] }, /command/);
    bad({ ...base, command: Array.from({ length: 21 }, () => "x") }, /At most/);
    bad({ ...base, ports: Array.from({ length: 21 }, (_, i) => ({ host: 1000 + i, container: 1 })) }, /At most/);
  });
  it("builds the Podman spec only from validated fields, with fixed hardening", () => {
    const spec = libpodSpec(ok({ ...base, ports: [{ host: 8080, container: 80 }], env: [{ key: "K", value: "v" }], volumes: [{ name: "d", path: "/data", readOnly: true }, { name: "e", path: "/e" }], network: "n1", restart: "on-failure", memoryMb: 256, command: ["a", "b"] }));
    assert.deepEqual(spec, {
      name: "web", image: "docker.io/library/nginx:latest", command: ["a", "b"], env: { K: "v" },
      portmappings: [{ container_port: 80, host_port: 8080, protocol: "tcp" }],
      volumes: [{ Name: "d", Dest: "/data", Options: ["ro"] }, { Name: "e", Dest: "/e", Options: [] }],
      netns: { nsmode: "bridge" }, Networks: { n1: {} },
      restart_policy: "on-failure", restart_tries: 5,
      resource_limits: { memory: { limit: 256 * 1024 * 1024 } },
      privileged: false, remove: false,
    });
    assert.deepEqual(libpodSpec(ok(base)), { name: "web", image: "docker.io/library/nginx:latest", restart_policy: "no", privileged: false, remove: false });
  });
});

const NEWID = "d".repeat(64);
describe("create container routes", () => {
  let fake: Fake;
  let agent: Running;
  const calls: { method: string; url: string; body: string }[] = [];
  let createStatus = 201;
  let startStatus = 204;
  let pullError = "";
  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        calls.push({ method: req.method ?? "", url: u, body: Buffer.concat(chunks).toString("utf8") });
        if (u === "/libpod/containers/create") {
          if (createStatus === 409) return jsonRes(res, 409, { message: "the container name is already in use" });
          if (createStatus !== 201) return jsonRes(res, 500, { message: "boom" });
          return jsonRes(res, 201, { Id: NEWID, Warnings: ["cpu limit ignored"] });
        }
        if (u === `/libpod/containers/${NEWID}/start`) return startStatus === 204 ? jsonRes(res, 204) : jsonRes(res, 500, { message: "crun: cannot start" });
        if (req.method === "DELETE" && u.startsWith(`/libpod/containers/${NEWID}`)) return jsonRes(res, 200, [{ Id: NEWID }]);
        if (u.startsWith("/libpod/images/pull?")) {
          res.writeHead(200);
          return void res.end(pullError ? JSON.stringify({ error: pullError }) + "\n" : JSON.stringify({ images: ["1".repeat(64)], id: "1".repeat(64) }) + "\n");
        }
        jsonRes(res, 404, { message: "nope" });
      });
    });
    agent = await startAgent(fake.socketPath, { rateLimitMax: 1000 });
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });
  const send = (path: string, body: unknown, headers: Record<string, string> = auth) =>
    fetch(`${agent.base}${path}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const lastCreate = () => calls.filter((c) => c.url === "/libpod/containers/create").at(-1);

  it("creates and starts a container and returns its id", async () => {
    calls.length = 0;
    const r = await send("/api/v1/containers", { name: "web", image: "docker.io/library/nginx:latest", env: [{ key: "SECRET", value: "pw" }], ports: [{ host: 8080, container: 80 }] });
    assert.equal(r.status, 201);
    assert.deepEqual((await r.json()).data, { id: NEWID, name: "web", warnings: ["cpu limit ignored"] });
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ["POST /libpod/containers/create", `POST /libpod/containers/${NEWID}/start`]);
    const spec = JSON.parse(lastCreate()!.body);
    assert.equal(spec.privileged, false);
    assert.deepEqual(spec.env, { SECRET: "pw" });
  });
  it("answers 400 for invalid requests without calling Podman", async () => {
    calls.length = 0;
    for (const b of [{ name: "x" }, { name: "web", image: "nginx", privileged: true }, { name: "web", image: "nginx", volumes: [{ name: "/etc", path: "/d" }] }]) {
      const r = await send("/api/v1/containers", b);
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error.code, "INVALID_PARAM");
    }
    assert.equal(calls.length, 0);
  });
  it("answers 400 for a body that is not JSON and 413 for a body that is too large", async () => {
    assert.equal((await send("/api/v1/containers", "{nope")).status, 400);
    const big = await send("/api/v1/containers", { name: "web", image: "nginx", env: Array.from({ length: 50 }, (_, i) => ({ key: `K${i}`, value: "x".repeat(4000) })) });
    assert.equal(big.status, 413);
  });
  it("requires the token", async () => {
    assert.equal((await send("/api/v1/containers", { name: "a", image: "b" }, {})).status, 401);
    assert.equal((await send("/api/v1/images/pull", { reference: "nginx" }, {})).status, 401);
  });
  it("reports a name that is already in use as 409 NAME_IN_USE", async () => {
    createStatus = 409;
    try {
      const r = await send("/api/v1/containers", { name: "web", image: "nginx" });
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error.code, "NAME_IN_USE");
    } finally { createStatus = 201; }
  });
  it("removes a container that was created but cannot be started", async () => {
    calls.length = 0;
    startStatus = 500;
    try {
      const r = await send("/api/v1/containers", { name: "web", image: "nginx" });
      assert.equal(r.status, 502);
      assert.match((await r.json()).error.message, /cannot start/);
      assert.ok(calls.some((c) => c.method === "DELETE" && c.url.startsWith(`/libpod/containers/${NEWID}?force=true`)), JSON.stringify(calls));
    } finally { startStatus = 204; }
  });
  it("pulls an image: validates the name and reports pull errors", async () => {
    calls.length = 0;
    const r = await send("/api/v1/images/pull", { reference: "docker.io/library/nginx:latest" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).data.id, "1".repeat(64));
    assert.match(calls[0]!.url, /^\/libpod\/images\/pull\?reference=docker\.io%2Flibrary%2Fnginx%3Alatest/);
    for (const b of [{}, { reference: "" }, { reference: "a b" }, { reference: "-x" }]) assert.equal((await send("/api/v1/images/pull", b)).status, 400);
    pullError = "pinging container registry x: Host not found";
    try {
      const e = await send("/api/v1/images/pull", { reference: "nginx" });
      assert.equal(e.status, 502);
      assert.match((await e.json()).error.message, /Host not found/);
    } finally { pullError = ""; }
  });
});

import { libpodPodSpec, parseCreatePodRequest } from "../src/podman/create.js";

describe("pod requests", () => {
  const okPod = (i: unknown) => { const r = parseCreatePodRequest(i); assert.equal(r.ok, true, JSON.stringify(r)); return (r as { ok: true; req: import("../src/podman/create.js").CreatePodRequest }).req; };
  const badPod = (i: unknown, re: RegExp) => { const r = parseCreatePodRequest(i); assert.equal(r.ok, false); assert.match((r as { ok: false; message: string }).message, re); };
  it("accepts name, ports, network and host name", () => {
    const r = okPod({ name: "app", ports: [{ host: 8080, container: 80 }], network: "appnet", hostname: "app1" });
    assert.deepEqual(libpodPodSpec(r), { name: "app", hostname: "app1", portmappings: [{ container_port: 80, host_port: 8080, protocol: "tcp" }], netns: { nsmode: "bridge" }, Networks: { appnet: {} } });
    assert.deepEqual(libpodPodSpec(okPod({ name: "app" })), { name: "app" });
  });
  it("rejects everything else", () => {
    badPod({ name: "../x" }, /Invalid pod name/);
    badPod({ name: "a", network: "host" }, /Invalid network/);
    badPod({ name: "a", hostname: "a b" }, /Invalid host name/);
    badPod({ name: "a", ports: [{ host: 0, container: 1 }] }, /Ports/);
    for (const f of ["privileged", "pid", "share", "infra_image", "userns"]) badPod({ name: "a", [f]: true }, /Unknown field/);
  });
  it("a container can join a pod, but then sets no ports or network", () => {
    assert.equal(ok({ ...base, pod: "app" }).pod, "app");
    assert.equal((libpodSpec(ok({ ...base, pod: "app" })) as { pod: string }).pod, "app");
    bad({ ...base, pod: "app", ports: [{ host: 1, container: 2 }] }, /in a pod/i);
    bad({ ...base, pod: "app", network: "n" }, /in a pod/i);
    bad({ ...base, pod: "a b" }, /Invalid pod name/);
  });
});

describe("create pod route", () => {
  it("creates a pod through podman and rejects invalid requests without calling it", async () => {
    const seen: { url: string; body: string }[] = [];
    const fake = await startFakePodman((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => {
        seen.push({ url: req.url ?? "", body: b });
        if (/\/libpod\/pods\/create$/.test(req.url ?? "")) return b.includes('"dup"') ? jsonRes(res, 409, { message: "exists", cause: "x", response: 409 }) : jsonRes(res, 201, { Id: "a".repeat(64) });
        jsonRes(res, 404, { message: "nope" });
      });
    });
    const agent = await startAgent(fake.socketPath, { rateLimitMax: 1000 });
    const post = (body: unknown) => fetch(agent.base + "/api/v1/pods", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      const r = await post({ name: "app", ports: [{ host: 8080, container: 80 }] });
      assert.equal(r.status, 201);
      assert.equal(((await r.json()) as { data: { id: string; name: string } }).data.name, "app");
      assert.equal((await post({ name: "dup" })).status, 409);
      const n = seen.length;
      assert.equal((await post({ name: "x", network: "host" })).status, 400);
      assert.equal((await post({ name: "x", privileged: true })).status, 400);
      assert.equal(seen.length, n);
    } finally { await agent.close(); await fake.close(); }
  });
});
