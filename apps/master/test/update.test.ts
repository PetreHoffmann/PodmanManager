import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { checkForUpdate, clearUpdateCache, compareSemver, latestStable, parseSemver, updateCheckEnabled, updateRepo } from "../src/lib/update-check";
import { getVersion } from "../src/lib/version";

type Sources = { registry?: boolean; hub?: boolean };
const URLS = {
  token: /^https:\/\/auth\.docker\.io\/token\?service=registry\.docker\.io&scope=repository:/,
  tags: /^https:\/\/registry-1\.docker\.io\/v2\/[^/]+\/[^/]+\/tags\/list\?n=1000$/,
  hub: /^https:\/\/hub\.docker\.com\/v2\/repositories\/[^/]+\/[^/]+\/tags\/\?page_size=100$/,
};
/** Fake Docker Hub: answers the registry API and/or the hub API; a source that is off behaves like a firewall. */
function fake(names: string[], on: Sources = { registry: true, hub: true }, log: string[] = []) {
  return async (url: string, init: RequestInit) => {
    log.push(url);
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
    if (URLS.token.test(url) && on.registry) return new Response(JSON.stringify({ token: "tok123" }));
    if (URLS.tags.test(url) && on.registry && auth === "Bearer tok123") return new Response(JSON.stringify({ name: "x", tags: names }));
    if (URLS.hub.test(url) && on.hub) return new Response(JSON.stringify({ results: names.map((name) => ({ name })) }));
    throw new TypeError("fetch failed");
  };
}
const tags = (...names: string[]) => fake(names);

describe("version", () => {
  it("prefers a valid APP_VERSION (strips v), otherwise falls back to package.json", () => {
    assert.equal(getVersion({ APP_VERSION: "v1.2.3" }), "1.2.3");
    assert.equal(getVersion({ APP_VERSION: "1.2.3-rc.1" }), "1.2.3-rc.1");
    const fallback = getVersion({});
    assert.match(fallback, /^\d+\.\d+\.\d+/);
    assert.equal(getVersion({ APP_VERSION: "latest" }), fallback);
    assert.equal(getVersion({ APP_VERSION: "1.2.3; rm -rf" }), fallback);
  });
});

describe("semver helpers", () => {
  it("parses and compares numerically", () => {
    assert.deepEqual(parseSemver("v0.10.2"), [0, 10, 2]);
    assert.equal(parseSemver("latest"), null);
    assert.equal(compareSemver("0.10.0", "0.9.9"), 1);
    assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
    assert.equal(compareSemver("0.3.0", "0.3.1"), -1);
  });
  it("picks the highest plain x.y.z tag", () => {
    assert.equal(latestStable(["latest", "sha-abc1234", "0.2.1", "0.10.0", "0.9.0", "1.0.0-rc1"]), "0.10.0");
    assert.equal(latestStable(["latest", "sha-abc"]), null);
  });
});

describe("update check", () => {
  beforeEach(() => clearUpdateCache());

  it("reports an available update", async () => {
    const r = await checkForUpdate("0.2.0", { fetchFn: tags("latest", "0.3.0", "0.2.1", "sha-1"), enabled: true });
    assert.deepEqual(r, { state: "ok", current: "0.2.0", latest: "0.3.0", newer: true, devBuild: false });
  });

  it("reports up to date, also when ahead of the registry", async () => {
    assert.equal(((await checkForUpdate("0.3.0", { fetchFn: tags("0.3.0"), enabled: true })) as { newer: boolean }).newer, false);
    clearUpdateCache();
    assert.equal(((await checkForUpdate("0.4.0", { fetchFn: tags("0.3.0"), enabled: true })) as { newer: boolean }).newer, false);
  });

  it("marks non-release builds as development builds without claiming an update", async () => {
    const r = await checkForUpdate("1.0.0-dev", { fetchFn: tags("0.3.0"), enabled: true });
    assert.deepEqual(r, { state: "ok", current: "1.0.0-dev", latest: "0.3.0", newer: false, devBuild: true });
  });

  it("degrades to unavailable on network errors, HTTP errors and empty results", async () => {
    assert.deepEqual(await checkForUpdate("0.3.0", { fetchFn: async () => { throw new Error("offline"); }, enabled: true }), { state: "unavailable" });
    clearUpdateCache();
    assert.deepEqual(await checkForUpdate("0.3.0", { fetchFn: async () => new Response("no", { status: 404 }), enabled: true }), { state: "unavailable" });
    clearUpdateCache();
    assert.deepEqual(await checkForUpdate("0.3.0", { fetchFn: tags("latest"), enabled: true }), { state: "unavailable" });
  });

  it("does nothing when disabled", async () => {
    let called = 0;
    const r = await checkForUpdate("0.3.0", { fetchFn: async () => { called++; return new Response("{}"); }, enabled: false });
    assert.deepEqual(r, { state: "disabled" });
    assert.equal(called, 0);
  });

  it("works when only the registry API is reachable (docker.io allowed, hub.docker.com blocked)", async () => {
    const log: string[] = [];
    const r = await checkForUpdate("0.3.0", { fetchFn: fake(["latest", "0.3.4", "0.3.0"], { registry: true }, log), enabled: true });
    assert.deepEqual(r, { state: "ok", current: "0.3.0", latest: "0.3.4", newer: true, devBuild: false });
    assert.ok(log.some((u) => URLS.tags.test(u)));
  });

  it("works when only the hub API is reachable", async () => {
    const r = await checkForUpdate("0.3.4", { fetchFn: fake(["0.3.4"], { hub: true }), enabled: true });
    assert.deepEqual(r, { state: "ok", current: "0.3.4", latest: "0.3.4", newer: false, devBuild: false });
  });

  it("is unavailable when both are blocked, the token is rejected or the tag list is malformed", async () => {
    assert.deepEqual(await checkForUpdate("0.3.0", { fetchFn: fake(["0.3.4"], {}), enabled: true }), { state: "unavailable" });
    clearUpdateCache();
    const badToken = async (u: string) => (URLS.token.test(u) ? new Response("{}", { status: 200 }) : Promise.reject(new TypeError("blocked")));
    assert.deepEqual(await checkForUpdate("0.3.0", { fetchFn: badToken, enabled: true }), { state: "unavailable" });
    clearUpdateCache();
    const badList = async (u: string) => (URLS.token.test(u) ? new Response(JSON.stringify({ token: "t" })) : URLS.tags.test(u) ? new Response(JSON.stringify({ tags: "nope" })) : Promise.reject(new TypeError("blocked")));
    assert.deepEqual(await checkForUpdate("0.3.0", { fetchFn: badList, enabled: true }), { state: "unavailable" });
  });

  it("caches results (6 h) and retries failures sooner (5 min)", async () => {
    const ok: string[] = [];
    const f = fake(["0.3.0"], { registry: true, hub: true }, ok);
    await checkForUpdate("0.3.0", { fetchFn: f, enabled: true, now: 0 });
    const afterFirst = ok.length;
    await checkForUpdate("0.3.0", { fetchFn: f, enabled: true, now: 3600_000 });
    assert.equal(ok.length, afterFirst, "served from cache");
    await checkForUpdate("0.3.0", { fetchFn: f, enabled: true, now: 7 * 3600_000 });
    assert.ok(ok.length > afterFirst, "refreshed after 6 h");
    clearUpdateCache();
    const bad: string[] = [];
    const blocked = fake(["0.3.0"], {}, bad);
    await checkForUpdate("0.3.0", { fetchFn: blocked, enabled: true, now: 0 });
    const failures = bad.length;
    await checkForUpdate("0.3.0", { fetchFn: blocked, enabled: true, now: 60_000 });
    assert.equal(bad.length, failures, "failure cached for 5 min");
    await checkForUpdate("0.3.0", { fetchFn: blocked, enabled: true, now: 6 * 60_000 });
    assert.ok(bad.length > failures, "retried after 5 min");
  });

  it("only queries the configured repository on the known Docker hosts and validates the override", async () => {
    const log: string[] = [];
    await checkForUpdate("0.3.0", { fetchFn: fake(["0.3.0"], { registry: true, hub: true }, log), enabled: true });
    assert.ok(log.length >= 3);
    for (const u of log) {
      assert.match(u, /^https:\/\/(auth\.docker\.io|registry-1\.docker\.io|hub\.docker\.com)\//);
      if (!u.startsWith("https://auth.docker.io")) assert.ok(u.includes("/petrecalinoiu/podmanmanager-master/"), u);
    }
    assert.equal(updateRepo({ UPDATE_CHECK_REPO: "me/my-master" }), "me/my-master");
    for (const bad of ["../etc", "a/b/c", "x", "a b/c", "https://evil/x"]) {
      assert.equal(updateRepo({ UPDATE_CHECK_REPO: bad }), "petrecalinoiu/podmanmanager-master", bad);
    }
    assert.equal(updateCheckEnabled({ UPDATE_CHECK: "off" }), false);
    assert.equal(updateCheckEnabled({ UPDATE_CHECK: "0" }), false);
    assert.equal(updateCheckEnabled({}), true);
  });
});

import { originAllowed, parseAllowedOrigins } from "../src/lib/origins";

describe("reverse proxy origin allowlist", () => {
  it("parses hosts, URLs and wildcards; drops junk", () => {
    assert.deepEqual(parseAllowedOrigins("Master.Example.com, https://pm.example.org:8443/ ,*.corp.example.com,bad host,,"), ["master.example.com", "pm.example.org:8443", "*.corp.example.com"]);
    assert.deepEqual(parseAllowedOrigins(undefined), []);
    assert.deepEqual(parseAllowedOrigins("javascript:alert(1), http://"), []);
  });
  it("matches exact hosts (incl. port) and wildcard subdomains only", () => {
    const p = parseAllowedOrigins("master.example.com,pm.example.org:8443,*.corp.example.com");
    assert.ok(originAllowed("master.example.com", p));
    assert.ok(originAllowed("MASTER.example.com", p));
    assert.ok(originAllowed("pm.example.org:8443", p));
    assert.ok(originAllowed("a.corp.example.com", p));
    assert.ok(!originAllowed("example.com", p));
    assert.ok(!originAllowed("master.example.com:8443", p));
    assert.ok(!originAllowed("pm.example.org", p));
    assert.ok(!originAllowed("corp.example.com", p));
    assert.ok(!originAllowed("evil-corp.example.com.attacker.net", p));
    assert.ok(!originAllowed("xcorp.example.com", p));
  });
});
