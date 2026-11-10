import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import net, { type AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { failCode, fetchViaProxy, makeProxyAwareFetch, noProxyMatch, proxyFor } from "../src/lib/proxy-fetch";

describe("proxy selection", () => {
  it("matches NO_PROXY entries (exact, suffix, wildcard, port, *)", () => {
    const l = "localhost, 10.0.0.1, .corp.example.com, *.lab.example.org, example.net:8443, banst-s.banst-pt.int";
    assert.ok(noProxyMatch("localhost", 443, l));
    assert.ok(noProxyMatch("10.0.0.1", 443, l));
    assert.ok(noProxyMatch("a.corp.example.com", 443, l));
    assert.ok(noProxyMatch("corp.example.com", 443, l));
    assert.ok(noProxyMatch("x.lab.example.org", 443, l));
    assert.ok(noProxyMatch("example.net", 8443, l));
    assert.ok(!noProxyMatch("example.net", 443, l));
    assert.ok(noProxyMatch("host.banst-s.banst-pt.int", 443, l));
    assert.ok(!noProxyMatch("evilcorp.example.com", 443, l));
    assert.ok(!noProxyMatch("registry-1.docker.io", 443, l));
    assert.ok(noProxyMatch("anything.io", 443, "*"));
    assert.ok(!noProxyMatch("anything.io", 443, undefined));
  });

  it("uses https_proxy / HTTPS_PROXY for https URLs, honours NO_PROXY, ignores unsupported schemes", () => {
    const u = new URL("https://auth.docker.io/token");
    assert.equal(proxyFor(u, { https_proxy: "http://wsa.example.int:80" })?.host, "wsa.example.int");
    assert.equal(proxyFor(u, { HTTPS_PROXY: "wsa.example.int:3128" })?.host, "wsa.example.int:3128");
    assert.equal(proxyFor(u, { https_proxy: "http://u:p@wsa:80" })?.username, "u");
    assert.equal(proxyFor(u, {}), null);
    assert.equal(proxyFor(u, { https_proxy: "http://wsa:80", no_proxy: "docker.io" }), null);
    assert.equal(proxyFor(u, { https_proxy: "socks5://wsa:1080" }), null);
    assert.equal(proxyFor(new URL("http://x.example/"), { https_proxy: "http://wsa:80" }), null);
  });

  it("reduces errors to short codes", () => {
    assert.equal(failCode(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } })), "ENOTFOUND");
    assert.equal(failCode(Object.assign(new Error("x"), { name: "TimeoutError" })), "TIMEOUT");
    assert.equal(failCode(new Error("HTTP_407")), "HTTP_407");
    assert.equal(failCode(new Error("some free text with details")), "ERROR");
    assert.equal(failCode("nope"), "ERROR");
  });
});

describe("HTTPS through an HTTP CONNECT proxy", () => {
  let dir: string, ca: string, server: ReturnType<typeof createHttpsServer>, proxy: ReturnType<typeof createHttpServer>;
  const seen: { connect: string[]; auth: (string | undefined)[]; paths: string[] } = { connect: [], auth: [], paths: [] };
  let mode: "ok" | "deny" = "ok";
  let serverPort = 0, proxyPort = 0;
  const sockets = new Set<{ destroy(): unknown }>();

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "pm-proxy-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" });
    ca = readFileSync(join(dir, "c.pem"), "utf8");
    server = createHttpsServer({ key: readFileSync(join(dir, "k.pem")), cert: ca }, (req, res) => {
      seen.paths.push(req.url ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ hello: "world", via: "tls-server" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    serverPort = (server.address() as AddressInfo).port;
    proxy = createHttpServer();
    proxy.on("connect", (req, clientSocket) => {
      sockets.add(clientSocket);
      seen.connect.push(req.url ?? "");
      seen.auth.push(req.headers["proxy-authorization"] as string | undefined);
      if (mode === "deny") {
        clientSocket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
        return;
      }
      const [host, port] = (req.url ?? "").split(":");
      const upstream = net.connect(Number(port), host, () => {
        sockets.add(upstream);
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => upstream.destroy());
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    proxyPort = (proxy.address() as AddressInfo).port;
  });
  after(async () => {
    for (const sk of sockets) sk.destroy();
    server.closeAllConnections();
    proxy.closeAllConnections();
    await new Promise((r) => server.close(r));
    await new Promise((r) => proxy.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it("tunnels the request, verifies the server certificate and returns a normal Response", async () => {
    const f = makeProxyAwareFetch({ https_proxy: `http://127.0.0.1:${proxyPort}` }, { ca });
    const res = await f(`https://localhost:${serverPort}/v2/x?n=1`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { hello: "world", via: "tls-server" });
    assert.ok(seen.connect.includes(`localhost:${serverPort}`));
    assert.ok(seen.paths.includes("/v2/x?n=1"));
  });

  it("sends proxy credentials from the proxy URL", async () => {
    await fetchViaProxy(new URL(`https://localhost:${serverPort}/a`), new URL(`http://user:p%40ss@127.0.0.1:${proxyPort}`), { signal: AbortSignal.timeout(5000) }, { ca });
    assert.equal(seen.auth.at(-1), `Basic ${Buffer.from("user:p@ss").toString("base64")}`);
  });

  it("does not trust an unknown certificate (no CA given)", async () => {
    await assert.rejects(fetchViaProxy(new URL(`https://localhost:${serverPort}/a`), new URL(`http://127.0.0.1:${proxyPort}`), { signal: AbortSignal.timeout(5000) }), (e: unknown) => /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/.test(failCode(e)) || /certificate/i.test(String((e as Error).message)));
  });

  it("reports a refusing proxy with its status code", async () => {
    mode = "deny";
    try {
      await assert.rejects(fetchViaProxy(new URL(`https://localhost:${serverPort}/a`), new URL(`http://127.0.0.1:${proxyPort}`), { signal: AbortSignal.timeout(5000) }, { ca }), (e: unknown) => failCode(e) === "PROXY_407");
    } finally {
      mode = "ok";
    }
  });

  it("reports an unreachable proxy as a connection error", async () => {
    const closed = await new Promise<number>((r) => { const l = net.createServer(); l.listen(0, "127.0.0.1", () => { const p = (l.address() as AddressInfo).port; l.close(() => r(p)); }); });
    await assert.rejects(fetchViaProxy(new URL(`https://localhost:${serverPort}/a`), new URL(`http://127.0.0.1:${closed}`), { signal: AbortSignal.timeout(5000) }, { ca }), (e: unknown) => failCode(e) === "ECONNREFUSED");
  });
});
