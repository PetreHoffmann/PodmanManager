import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { auth, jsonRes, startAgent, startFakePodman, type Fake, type Running } from "./helpers.js";

const calls: string[] = [];
let dfOk = true;

const vols = () => [
  { Name: "data", Driver: "local", CreatedAt: "2026-11-01T10:00:00Z", Anonymous: false },
  { Name: "a".repeat(64), Driver: "local", CreatedAt: "2026-11-02T10:00:00Z", Anonymous: true },
];
const nets = () => [
  { name: "podman", id: "1".repeat(64), driver: "bridge", subnets: [{ subnet: "10.88.0.0/16", gateway: "10.88.0.1" }], internal: false, dns_enabled: false, ipv6_enabled: false },
  { name: "app-net", id: "2".repeat(64), driver: "bridge", subnets: [{ subnet: "10.89.1.0/24", gateway: "10.89.1.1" }], internal: true, dns_enabled: true, ipv6_enabled: true },
  { name: "old-net", id: "3".repeat(64), driver: "bridge", subnets: [], dns_enabled: true },
];

describe("volumes and networks", () => {
  let fake: Fake;
  let agent: Running;
  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      calls.push(`${req.method} ${u}`);
      if (req.method === "GET" && u.startsWith("/libpod/volumes/json")) {
        return jsonRes(res, 200, u.includes("filters") ? [vols()[1]] : vols());
      }
      if (req.method === "GET" && u === "/libpod/system/df") return dfOk ? jsonRes(res, 200, { Volumes: [{ VolumeName: "data", Links: 1, Size: 4096 }, { VolumeName: "a".repeat(64), Links: 0, Size: 10 }] }) : jsonRes(res, 500, { message: "slow" });
      if (req.method === "DELETE" && u.startsWith("/libpod/volumes/data")) return jsonRes(res, 409, { message: "volume is being used" });
      if (req.method === "DELETE" && u.startsWith("/libpod/volumes/gone")) return jsonRes(res, 404, { message: "no such volume" });
      if (req.method === "DELETE" && u.startsWith("/libpod/volumes/")) { res.writeHead(204); return void res.end(); }
      if (req.method === "GET" && u === "/libpod/networks/json") return jsonRes(res, 200, nets());
      if (req.method === "GET" && u === "/libpod/containers/json") return jsonRes(res, 200, [{ Names: ["web"], Networks: ["app-net"] }, { Names: ["db"], Networks: ["app-net", "podman"] }]);
      if (req.method === "DELETE" && u.startsWith("/libpod/networks/app-net")) return jsonRes(res, 200, [{ Name: "app-net", Err: "network app-net is being used by container web" }]);
      if (req.method === "DELETE" && u.startsWith("/libpod/networks/busy5")) return jsonRes(res, 500, { cause: "network is being used", message: "\"busy5\" has associated containers with it. Use -f to forcibly delete containers and pods: network is being used", response: 500 });
      if (req.method === "DELETE" && u.startsWith("/libpod/networks/nope")) return jsonRes(res, 404, { message: "network not found" });
      if (req.method === "DELETE" && u.startsWith("/libpod/networks/")) return jsonRes(res, 200, [{ Name: "old-net" }]);
      jsonRes(res, 404, { message: "x" });
    });
    agent = await startAgent(fake.socketPath, { rateLimitMax: 100 });
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });
  const get = (p: string, method = "GET") => fetch(`${agent.base}/api/v1${p}`, { method, headers: auth });

  it("lists volumes with use and size", async () => {
    const d = (await (await get("/volumes")).json()).data as { name: string; unused: boolean; anonymous: boolean; size: number | null; driver: string }[];
    assert.equal(d.length, 2);
    const data = d.find((v) => v.name === "data")!;
    assert.deepEqual([data.unused, data.anonymous, data.size, data.driver], [false, false, 4096, "local"]);
    const anon = d.find((v) => v.name.startsWith("aaaa"))!;
    assert.deepEqual([anon.unused, anon.anonymous, anon.size], [true, true, 10]);
  });

  it("still lists volumes (size unknown) when the storage report fails", async () => {
    dfOk = false;
    const d = (await (await get("/volumes")).json()).data as { size: number | null }[];
    dfOk = true;
    assert.equal(d.length, 2);
    assert.ok(d.every((v) => v.size === null));
  });

  it("removes an unused volume and refuses a used or unknown one", async () => {
    calls.length = 0;
    const ok = await get(`/volumes/${"a".repeat(64)}`, "DELETE");
    assert.equal(ok.status, 200);
    assert.ok(calls.some((c) => c === `DELETE /libpod/volumes/${"a".repeat(64)}?force=false`), calls.join("\n"));
    const used = await get("/volumes/data", "DELETE");
    assert.equal(used.status, 409);
    assert.equal((await used.json()).error.code, "VOLUME_IN_USE");
    assert.equal((await get("/volumes/gone", "DELETE")).status, 404);
  });

  it("rejects bad names without asking Podman", async () => {
    calls.length = 0;
    for (const bad of ["..", "a%2Fb", "-x", "x y", "x".repeat(300)]) {
      const r = await get(`/volumes/${bad}`, "DELETE");
      assert.equal(r.status, 404, bad);
    }
    assert.equal(calls.filter((c) => c.startsWith("DELETE")).length, 0, calls.join("\n"));
  });

  it("lists networks with subnets, flags and attached running containers", async () => {
    const d = (await (await get("/networks")).json()).data as { name: string; subnets: string[]; internal: boolean; dnsEnabled: boolean; ipv6: boolean; containers: string[]; protected: boolean }[];
    const by = (n: string) => d.find((x) => x.name === n)!;
    assert.deepEqual(by("app-net").containers, ["db", "web"]);
    assert.deepEqual([by("app-net").subnets, by("app-net").internal, by("app-net").dnsEnabled, by("app-net").ipv6], [["10.89.1.0/24"], true, true, true]);
    assert.equal(by("podman").protected, true);
    assert.equal(by("old-net").protected, false);
    assert.deepEqual(by("old-net").subnets, []);
  });

  it("removes an unused network; refuses the default one, one in use and an unknown one", async () => {
    calls.length = 0;
    assert.equal((await get("/networks/old-net", "DELETE")).status, 200);
    const def = await get("/networks/podman", "DELETE");
    assert.equal(def.status, 409);
    assert.equal((await def.json()).error.code, "NETWORK_PROTECTED");
    assert.ok(!calls.some((c) => c.includes("/networks/podman")), "the default network is never sent to Podman");
    const used = await get("/networks/app-net", "DELETE");
    assert.equal(used.status, 409);
    assert.equal((await used.json()).error.code, "NETWORK_IN_USE");
    const busy5 = await get("/networks/busy5", "DELETE");
    assert.equal(busy5.status, 409);
    assert.equal((await busy5.json()).error.code, "NETWORK_IN_USE");
    assert.equal((await get("/networks/nope", "DELETE")).status, 404);
  });

  it("only allows GET for the lists and DELETE for one item", async () => {
    assert.equal((await get("/volumes", "POST")).status, 405);
    assert.equal((await get("/networks/x", "GET")).status, 405);
    assert.equal((await get("/volumes/a/b", "DELETE")).status, 404);
  });
});
