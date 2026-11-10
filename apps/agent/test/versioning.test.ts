import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PodmanClient } from "../src/podman/client.js";
import { FALLBACK_API_VERSION, PodmanService } from "../src/podman/service.js";
import { ID, jsonRes, realisticPodman, startFakePodman } from "./helpers.js";

describe("libpod API versioning (real Podman answers 404 for unversioned routes)", () => {
  it("uses the version announced by Libpod-Api-Version for all calls", async () => {
    const fake = await startFakePodman((req, res) => {
      if (req.url === "/libpod/version") return jsonRes(res, 200, { Version: "5.2.0", ApiVersion: "1.41" });
      if (req.url === "/libpod/containers/json?all=true") return jsonRes(res, 200, []);
      if (req.url === `/libpod/containers/${ID}/json`) return jsonRes(res, 200, { Id: ID, Name: "web", State: { Status: "running" } });
      if (req.url === `/libpod/containers/${ID}/stop?timeout=10`) return jsonRes(res, 204);
      jsonRes(res, 404, { message: "nope" });
    });
    try {
      const svc = new PodmanService(new PodmanClient(fake.socketPath, 2000), 10);
      await svc.ping();
      assert.equal((await svc.version()).version, "5.2.0");
      assert.deepEqual(await svc.list(), []);
      assert.equal((await svc.act(ID, "stop")).container.name, "web");
      for (const c of fake.calls.filter((c) => !c.includes("_ping"))) assert.match(c, /^(GET|POST) \/v4\.9\.3\/libpod\//, c);
    } finally {
      await fake.close();
    }
  });

  it("detects the version lazily when no ping happened yet", async () => {
    const fake = await startFakePodman((req, res) => (req.url === "/libpod/containers/json?all=true" ? jsonRes(res, 200, []) : jsonRes(res, 404, {})));
    try {
      assert.deepEqual(await new PodmanService(new PodmanClient(fake.socketPath, 2000), 10).list(), []);
      assert.ok(fake.calls[0]!.includes("_ping") && fake.calls[1]!.startsWith("GET /v4.9.3/libpod/containers/json"));
    } finally {
      await fake.close();
    }
  });

  it("falls back to a fixed version when the ping header is missing or malformed", async () => {
    for (const header of [null, "garbage"]) {
      const dir = mkdtempSync(join(tmpdir(), "pm-ver-"));
      const sock = join(dir, "p.sock");
      const seen: string[] = [];
      const server = createServer((req, res) => {
        seen.push(req.url ?? "");
        if (req.url === "/libpod/_ping") {
          res.writeHead(200, header ? { "Libpod-Api-Version": header } : {});
          return void res.end("OK");
        }
        realisticPodman((q, r) => jsonRes(r, 200, []), FALLBACK_API_VERSION)(req, res);
      });
      await new Promise<void>((r) => server.listen(sock, r));
      try {
        await new PodmanService(new PodmanClient(sock, 2000), 10).list();
        assert.ok(seen.some((u) => u.startsWith(`/v${FALLBACK_API_VERSION}/libpod/containers/json`)), seen.join(","));
      } finally {
        await new Promise((r) => server.close(r));
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("re-learns the version on every ping (e.g. after a Podman upgrade)", async () => {
    let version = "4.9.3";
    const dir = mkdtempSync(join(tmpdir(), "pm-ver-"));
    const sock = join(dir, "p.sock");
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.url ?? "");
      realisticPodman((q, r) => jsonRes(r, 200, []), version)(req, res);
    });
    await new Promise<void>((r) => server.listen(sock, r));
    try {
      const svc = new PodmanService(new PodmanClient(sock, 2000), 10);
      await svc.ping(); await svc.list();
      version = "5.3.1";
      await svc.ping(); await svc.list();
      assert.ok(seen.includes("/v4.9.3/libpod/containers/json?all=true") && seen.includes("/v5.3.1/libpod/containers/json?all=true"));
    } finally {
      await new Promise((r) => server.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
