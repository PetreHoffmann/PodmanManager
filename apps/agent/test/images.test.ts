import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { auth, jsonRes, startAgent, startFakePodman, type Fake, type Running } from "./helpers.js";

const A = "a".repeat(64); // two tags
const B = "b".repeat(64); // used by a container
const C = "c".repeat(64); // dangling
const D = "d".repeat(64); // the agent's own image
const calls: string[] = [];

const images = () => [
  { Id: A, RepoTags: ["docker.io/x/app:latest", "docker.io/x/app:1.0"], Size: 1000, Created: 1794323775 },
  { Id: B, RepoTags: ["docker.io/x/db:1"], Size: 2000, Created: 1794323775 },
  { Id: C, RepoTags: ["<none>:<none>"], Size: 300, Created: 1794323775 },
  { Id: D, RepoTags: ["docker.io/x/agent:latest"], Size: 400, Created: 1794323775 },
];

describe("images", () => {
  let fake: Fake;
  let agent: Running;
  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      calls.push(`${req.method} ${u}`);
      if (u === "/libpod/images/json") return jsonRes(res, 200, images());
      if (u.startsWith("/libpod/containers/json")) return jsonRes(res, 200, [{ Id: "f".repeat(64), ImageID: B }]);
      if (req.method === "DELETE" && u.startsWith("/libpod/images/")) return jsonRes(res, 200, [{ Deleted: "x" }]);
      if (req.method === "POST" && u.startsWith("/libpod/images/prune")) return jsonRes(res, 200, [{ Id: C, Size: 300 }, { Id: "e".repeat(64), Err: "busy" }]);
      jsonRes(res, 404, { message: "x" });
    });
    agent = await startAgent(fake.socketPath, { rateLimitMax: 100 }, undefined, undefined, [D]);
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });
  const get = (p: string, method = "GET") => fetch(`${agent.base}/api/v1${p}`, { method, headers: auth });

  it("lists images with tags, usage, dangling and protected flags", async () => {
    const d = (await (await get("/images")).json()).data as { id: string; tags: string[]; containers: number; dangling: boolean; protected: boolean; size: number }[];
    const by = (id: string) => d.find((i) => i.id === id)!;
    assert.deepEqual(by(A).tags, ["docker.io/x/app:latest", "docker.io/x/app:1.0"]);
    assert.equal(by(B).containers, 1);
    assert.equal(by(C).dangling, true);
    assert.deepEqual(by(C).tags, []);
    assert.equal(by(D).protected, true);
    assert.equal(by(A).protected, false);
    assert.equal(by(A).size, 1000);
  });

  it("deletes only the chosen tag when the image has several", async () => {
    calls.length = 0;
    const r = await get(`/images/${A}?tag=${encodeURIComponent("docker.io/x/app:1.0")}`, "DELETE");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).data.result, "untagged");
    assert.ok(calls.some((c) => c === "DELETE /libpod/images/docker.io/x/app%3A1.0?force=false"), calls.join("\n"));
  });

  it("deletes the whole image by id when it is the last reference or dangling", async () => {
    calls.length = 0;
    const r = await get(`/images/${C}`, "DELETE");
    assert.equal((await r.json()).data.result, "removed");
    assert.ok(calls.some((c) => c === `DELETE /libpod/images/${C}?force=false`));
  });

  it("refuses images in use and protected images (409) without calling Podman's delete", async () => {
    calls.length = 0;
    let r = await get(`/images/${B}?tag=${encodeURIComponent("docker.io/x/db:1")}`, "DELETE");
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "IMAGE_IN_USE");
    r = await get(`/images/${D}`, "DELETE");
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error.code, "IMAGE_PROTECTED");
    assert.ok(!calls.some((c) => c.startsWith("DELETE")));
  });

  it("validates ids and tags, 404 for unknown images/tags, 405 for wrong methods", async () => {
    assert.equal((await get("/images/xyz", "DELETE")).status, 404);
    assert.equal((await get(`/images/${"9".repeat(64)}`, "DELETE")).status, 404);
    assert.equal((await get(`/images/${A}?tag=${encodeURIComponent("a b;rm")}`, "DELETE")).status, 400);
    assert.equal((await get(`/images/${A}?tag=docker.io/x/other:1`, "DELETE")).status, 404);
    assert.equal((await get(`/images/${A}`)).status, 405);
    assert.equal((await get("/images", "POST")).status, 405);
    assert.equal((await get("/images/prune")).status, 405);
    assert.equal((await fetch(`${agent.base}/api/v1/images`)).status, 401);
  });

  it("prunes dangling images and reports what was removed", async () => {
    const r = await get("/images/prune", "POST");
    assert.deepEqual((await r.json()).data, { removed: 1, reclaimed: 300 });
    assert.ok(calls.some((c) => c.startsWith("POST /libpod/images/prune?all=false&filters=")));
  });
});
