import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { checkForUpdate, clearUpdateCache, compareSemver, latestStable, parseSemver, updateCheckEnabled, updateRepo } from "../src/lib/update-check";
import { getVersion } from "../src/lib/version";

const tags = (...names: string[]) => async () => new Response(JSON.stringify({ results: names.map((name) => ({ name })) }), { status: 200 });

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

  it("caches results (6 h) and retries failures sooner (5 min)", async () => {
    let calls = 0;
    const f = async () => { calls++; return tags("0.3.0")(); };
    await checkForUpdate("0.3.0", { fetchFn: f, enabled: true, now: 0 });
    await checkForUpdate("0.3.0", { fetchFn: f, enabled: true, now: 3600_000 });
    assert.equal(calls, 1);
    await checkForUpdate("0.3.0", { fetchFn: f, enabled: true, now: 7 * 3600_000 });
    assert.equal(calls, 2);
    clearUpdateCache();
    let fails = 0;
    const bad = async () => { fails++; throw new Error("x"); };
    await checkForUpdate("0.3.0", { fetchFn: bad, enabled: true, now: 0 });
    await checkForUpdate("0.3.0", { fetchFn: bad, enabled: true, now: 60_000 });
    assert.equal(fails, 1);
    await checkForUpdate("0.3.0", { fetchFn: bad, enabled: true, now: 6 * 60_000 });
    assert.equal(fails, 2);
  });

  it("only queries the configured Docker Hub repository and validates the override", async () => {
    let url = "";
    await checkForUpdate("0.3.0", { fetchFn: async (u) => { url = u; return tags("0.3.0")(); }, enabled: true });
    assert.equal(url, "https://hub.docker.com/v2/repositories/petrecalinoiu/podmanmanager-master/tags/?page_size=100");
    assert.equal(updateRepo({ UPDATE_CHECK_REPO: "me/my-master" }), "me/my-master");
    for (const bad of ["../etc", "a/b/c", "x", "a b/c", "https://evil/x"]) {
      assert.equal(updateRepo({ UPDATE_CHECK_REPO: bad }), "petrecalinoiu/podmanmanager-master", bad);
    }
    assert.equal(updateCheckEnabled({ UPDATE_CHECK: "off" }), false);
    assert.equal(updateCheckEnabled({ UPDATE_CHECK: "0" }), false);
    assert.equal(updateCheckEnabled({}), true);
  });
});
