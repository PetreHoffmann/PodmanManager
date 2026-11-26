import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextSort, naturalCompare, parseSort, sortHosts, versionParts, type SortableHost } from "../src/lib/host-sort";

const host = (id: string, o: Partial<SortableHost["agent"]> & { containers?: number | null; storage?: number | null } = {}): SortableHost => ({
  agent: { agent_id: id, address: id + ".lan", port: 9126, kind: "remote", enabled: 1, status: "online", last_heartbeat: null, podman_version: null, agent_version: null, ...o },
  containers: o.containers ?? null,
  storage: o.storage ?? null,
});
const ids = (l: SortableHost[]) => l.map((h) => h.agent.agent_id);

describe("sort parameters", () => {
  it("accepts known columns and ignores the rest", () => {
    assert.deepEqual(parseSort("agent", "desc"), { key: "agent", dir: "desc" });
    assert.deepEqual(parseSort("storage", undefined), { key: "storage", dir: "asc" });
    assert.equal(parseSort("evil", "asc"), null);
    assert.equal(parseSort(undefined, "desc"), null);
  });
  it("cycles ascending, descending, default", () => {
    assert.deepEqual(nextSort(null, "status"), { key: "status", dir: "asc" });
    assert.deepEqual(nextSort({ key: "status", dir: "asc" }, "status"), { key: "status", dir: "desc" });
    assert.equal(nextSort({ key: "status", dir: "desc" }, "status"), null);
    assert.deepEqual(nextSort({ key: "agent", dir: "desc" }, "status"), { key: "status", dir: "asc" });
  });
});

describe("comparison", () => {
  it("compares numbers inside text as numbers", () => {
    assert.ok(naturalCompare("host-2", "host-10") < 0);
    assert.ok(naturalCompare("Host-1", "host-1") === 0);
    assert.ok(naturalCompare("a", "b") < 0);
  });
  it("reads versions from Podman and agent strings", () => {
    assert.deepEqual(versionParts("4.9.4-rhel"), [4, 9, 4]);
    assert.deepEqual(versionParts("v0.28.0"), [0, 28, 0]);
    assert.equal(versionParts("—"), null);
    assert.equal(versionParts(null), null);
  });
});

describe("sorting hosts", () => {
  it("sorts by agent id naturally in both directions", () => {
    const l = [host("h-10"), host("h-2"), host("h-1")];
    assert.deepEqual(ids(sortHosts(l, { key: "agent", dir: "asc" })), ["h-1", "h-2", "h-10"]);
    assert.deepEqual(ids(sortHosts(l, { key: "agent", dir: "desc" })), ["h-10", "h-2", "h-1"]);
  });
  it("sorts versions numerically (0.9.2 before 0.28.0)", () => {
    const l = [host("a", { agent_version: "0.28.0" }), host("b", { agent_version: "0.9.2" }), host("c", { agent_version: "0.27.1" })];
    assert.deepEqual(ids(sortHosts(l, { key: "version", dir: "asc" })), ["b", "c", "a"]);
  });
  it("puts missing values last, in both directions", () => {
    const l = [host("none"), host("big", { storage: 900 }), host("small", { storage: 10 })];
    assert.deepEqual(ids(sortHosts(l, { key: "storage", dir: "asc" })), ["small", "big", "none"]);
    assert.deepEqual(ids(sortHosts(l, { key: "storage", dir: "desc" })), ["big", "small", "none"]);
  });
  it("ranks the status online first and disabled last; problems come first when descending", () => {
    const l = [host("off", { status: "offline" }), host("dis", { enabled: 0 }), host("on"), host("deg", { status: "degraded" })];
    assert.deepEqual(ids(sortHosts(l, { key: "status", dir: "asc" })), ["on", "deg", "off", "dis"]);
    assert.deepEqual(ids(sortHosts(l, { key: "status", dir: "desc" })), ["dis", "off", "deg", "on"]);
  });
  it("sorts the heartbeat by time and containers by count; equal values keep their order", () => {
    const l = [host("a", { last_heartbeat: "2026-11-26T10:00:00Z", containers: 2 }), host("b", { last_heartbeat: "2026-11-26T09:00:00Z", containers: 2 }), host("c", { last_heartbeat: "2026-11-26T11:00:00Z", containers: 5 })];
    assert.deepEqual(ids(sortHosts(l, { key: "heartbeat", dir: "asc" })), ["b", "a", "c"]);
    assert.deepEqual(ids(sortHosts(l, { key: "containers", dir: "asc" })), ["a", "b", "c"]);
    assert.deepEqual(ids(sortHosts(l, { key: "containers", dir: "desc" })), ["c", "a", "b"]);
  });
  it("returns the list unchanged without a sort and never changes the input", () => {
    const l = [host("z"), host("a")];
    assert.deepEqual(ids(sortHosts(l, null)), ["z", "a"]);
    sortHosts(l, { key: "agent", dir: "asc" });
    assert.deepEqual(ids(l), ["z", "a"]);
  });
});
