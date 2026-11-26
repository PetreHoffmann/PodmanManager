import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pollUpdate, type UpdateStatus } from "../src/lib/update-poll";
import { startAgent, startFakePodman, jsonRes, TOKEN } from "../../agent/test/helpers.js";
import { agentSelfInfo, agentUpdateStart } from "../src/lib/agent-client";

const seq = (...items: (UpdateStatus | null | "throw")[]) => {
  let i = 0;
  return async () => {
    const x = items[Math.min(i++, items.length - 1)];
    if (x === "throw") throw new Error("down");
    return x ?? null;
  };
};
const fast = { sleep: async () => {}, intervalMs: 1 };

describe("following an agent update", () => {
  it("reports the error message of a failed pull", async () => {
    assert.deepEqual(await pollUpdate(seq({ state: "pulling" }, { state: "pulling" }, { state: "error", message: "Host not found" }), fast), { kind: "error", message: "Host not found" });
  });
  it("reports an unchanged image", async () => {
    assert.deepEqual(await pollUpdate(seq({ state: "pulling" }, { state: "current", message: "Already up to date" }), fast), { kind: "current" });
  });
  it("treats restarting, an unreachable agent after pulling and a forgotten state as a restart", async () => {
    assert.deepEqual(await pollUpdate(seq({ state: "pulling" }, { state: "restarting" }), fast), { kind: "restarting" });
    assert.deepEqual(await pollUpdate(seq({ state: "pulling" }, null), fast), { kind: "restarting" });
    assert.deepEqual(await pollUpdate(seq({ state: "pulling" }, "throw"), fast), { kind: "restarting" });
    assert.deepEqual(await pollUpdate(seq({ state: "idle" }), fast), { kind: "restarting" });
  });
  it("gives up after the timeout while it is still pulling", async () => {
    let t = 0;
    const r = await pollUpdate(seq({ state: "pulling" }), { sleep: async () => { t += 3000; }, now: () => t, timeoutMs: 9000, intervalMs: 3000 });
    assert.deepEqual(r, { kind: "timeout" });
  });
  it("waits through an agent that does not answer yet, until the timeout", async () => {
    let t = 0;
    const r = await pollUpdate(seq(null), { sleep: async () => { t += 3000; }, now: () => t, timeoutMs: 6000, intervalMs: 3000 });
    assert.deepEqual(r, { kind: "timeout" });
  });
});

describe("update of a real agent that cannot pull", () => {
  const SELF = "c".repeat(64);
  const mi = [`1 1 0:1 /run/user/1000/containers/overlay-containers/${SELF}/userdata/hosts /etc/hosts rw - ext4 /dev x`].join("\n");
  it("the master learns the reason from the agent", async () => {
    const fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      if (u === `/libpod/containers/${SELF}/json`) return jsonRes(res, 200, { Id: SELF, Name: "agent", ImageName: "nexus.example/petrecalinoiu/podmanmanager-agent:latest", Image: "1".repeat(64), Config: { Labels: { PODMAN_SYSTEMD_UNIT: "podmanmanager-agent.service" } } });
      if (u.startsWith("/libpod/images/pull?")) return jsonRes(res, 500, { message: "pinging container registry nexus.example: Host not found", cause: "x", response: 500 });
      jsonRes(res, 404, { message: "nope" });
    });
    const agent = await startAgent(fake.socketPath, {}, { mountinfo: () => mi, exit: () => {}, exitDelayMs: 10 });
    try {
      const { port } = new URL(agent.base);
      const target = { address: "127.0.0.1", port: Number(port), token: TOKEN };
      const started = await agentUpdateStart(target);
      assert.equal(started.ok, true);
      const o = await pollUpdate(async () => {
        const r = await agentSelfInfo(target);
        return r.ok ? { state: r.data.state as UpdateStatus["state"], message: r.data.message } : null;
      }, { intervalMs: 50, timeoutMs: 5000 });
      assert.equal(o.kind, "error");
      assert.match(o.message ?? "", /Host not found/);
    } finally {
      await agent.close();
      await fake.close();
    }
  });
});
