import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MAX_LINE_CHARS, parseLogStream } from "../src/podman/logs.js";
import { ID, auth, jsonRes, startAgent, startFakePodman } from "./helpers.js";

function frame(stream: 0 | 1 | 2, text: string): Buffer {
  const p = Buffer.from(text, "utf8");
  const h = Buffer.alloc(8);
  h[0] = stream;
  h.writeUInt32BE(p.length, 4);
  return Buffer.concat([h, p]);
}

describe("log stream parsing", () => {
  it("demultiplexes frames into stdout/stderr lines with timestamps", () => {
    const buf = Buffer.concat([
      frame(1, "2026-11-10T21:13:11Z line 1\n"),
      frame(2, "2026-11-10T21:13:12.123456789Z boom\n"),
      frame(1, "2026-11-10T21:13:13+01:00 two\nthree\n"),
    ]);
    assert.deepEqual(parseLogStream(buf, 100), [
      { ts: "2026-11-10T21:13:11Z", stream: "stdout", text: "line 1" },
      { ts: "2026-11-10T21:13:12.123456789Z", stream: "stderr", text: "boom" },
      { ts: "2026-11-10T21:13:13+01:00", stream: "stdout", text: "two" },
      { ts: null, stream: "stdout", text: "three" },
    ]);
  });

  it("keeps only the last `tail` lines", () => {
    const buf = Buffer.concat(Array.from({ length: 10 }, (_, i) => frame(1, `2026-11-10T00:00:0${i}Z l${i}\n`)));
    assert.deepEqual(parseLogStream(buf, 3).map((l) => l.text), ["l7", "l8", "l9"]);
  });

  it("handles TTY output (CRLF) and treats stdin frames as stdout", () => {
    const l = parseLogStream(Buffer.concat([frame(1, "2026-11-10T21:13:11Z tty 1\r\n"), frame(0, "2026-11-10T21:13:12Z in\r\n")]), 10);
    assert.deepEqual(l.map((x) => [x.stream, x.text]), [["stdout", "tty 1"], ["stdout", "in"]]);
  });

  it("falls back to plain text when there is no frame header", () => {
    assert.deepEqual(parseLogStream(Buffer.from("2026-11-10T21:13:11Z hello\nworld\n"), 10), [
      { ts: "2026-11-10T21:13:11Z", stream: "stdout", text: "hello" },
      { ts: null, stream: "stdout", text: "world" },
    ]);
    assert.deepEqual(parseLogStream(Buffer.alloc(0), 10), []);
  });

  it("strips ANSI escapes and control characters, truncates very long lines", () => {
    const [a] = parseLogStream(frame(1, "2026-11-10T21:13:11Z \x1b[31mred\x1b[0m\x07 \x00ok\x1b]0;title\x07\n"), 10);
    assert.equal(a!.text, "red ok");
    const [b] = parseLogStream(frame(1, `x${"y".repeat(5000)}\n`), 10);
    assert.equal(b!.text.length, MAX_LINE_CHARS + 1);
    assert.ok(b!.text.endsWith("…"));
  });

  it("does not choke on a truncated frame or invalid UTF-8", () => {
    const full = frame(1, "2026-11-10T21:13:11Z complete\n");
    const cut = Buffer.concat([full, frame(1, "partial line that is cut off").subarray(0, 12)]);
    assert.deepEqual(parseLogStream(cut, 10).map((x) => x.text), ["complete"]);
    assert.equal(parseLogStream(frame(1, "bad \xff\xfe bytes\n"), 10).length, 1);
  });
});

describe("agent logs route", () => {
  let fake: Awaited<ReturnType<typeof startFakePodman>>;
  let agent: Awaited<ReturnType<typeof startAgent>>;
  const queries: string[] = [];
  const LONG = "d".repeat(64);
  const NONE = "e".repeat(64);
  const BIG = "f".repeat(64);

  before(async () => {
    fake = await startFakePodman((req, res) => {
      const u = req.url ?? "";
      const m = /^\/libpod\/containers\/([a-f0-9]+)\/logs\?(.*)$/.exec(u);
      if (!m) return jsonRes(res, 404, { message: "nope" });
      queries.push(m[2]!);
      if (m[1] === NONE) return jsonRes(res, 500, { message: "this container is using the 'none' log driver, cannot read logs", cause: "x", response: 500 });
      if (m[1] === BIG) {
        res.writeHead(200);
        return void res.end(frame(1, "x".repeat(5 * 1024 * 1024)));
      }
      if (m[1] !== ID && m[1] !== LONG) return jsonRes(res, 404, { message: "no such container" });
      res.writeHead(200, { "Content-Type": "application/vnd.docker.raw-stream" });
      res.end(Buffer.concat([frame(1, "2026-11-10T21:13:11Z hello\n"), frame(2, "2026-11-10T21:13:12Z oops\n")]));
    });
    agent = await startAgent(fake.socketPath, { rateLimitMax: 1000 });
  });
  after(async () => {
    await agent.close();
    await fake.close();
  });

  const get = (p: string, h: Record<string, string> = auth) => fetch(agent.base + p, { headers: h });

  it("returns parsed lines and asks Podman for stdout+stderr with timestamps and the default tail 150", async () => {
    const r = await get(`/api/v1/containers/${ID}/logs`);
    assert.equal(r.status, 200);
    const b = (await r.json()) as { ok: boolean; data: { tail: number; lines: { stream: string; text: string }[] } };
    assert.equal(b.data.tail, 150);
    assert.deepEqual(b.data.lines.map((l) => [l.stream, l.text]), [["stdout", "hello"], ["stderr", "oops"]]);
    assert.equal(queries.at(-1), "stdout=true&stderr=true&tail=150&timestamps=true");
  });

  it("passes a validated tail value through", async () => {
    await get(`/api/v1/containers/${ID}/logs?tail=20`);
    assert.match(queries.at(-1)!, /tail=20&/);
    await get(`/api/v1/containers/${ID}/logs?tail=500`);
    assert.match(queries.at(-1)!, /tail=500&/);
  });

  it("rejects invalid tail values without calling Podman", async () => {
    const before = queries.length;
    for (const bad of ["0", "501", "abc", "-1", "1e2", "", "150;rm", "99999"]) {
      const r = await get(`/api/v1/containers/${ID}/logs?tail=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 400, bad);
      assert.equal(((await r.json()) as any).error.code, "INVALID_PARAM");
    }
    assert.equal(queries.length, before);
  });

  it("requires auth, a valid id and GET", async () => {
    assert.equal((await get(`/api/v1/containers/${ID}/logs`, {})).status, 401);
    assert.equal((await get(`/api/v1/containers/web/logs`)).status, 400);
    assert.equal((await fetch(agent.base + `/api/v1/containers/${ID}/logs`, { method: "POST", headers: auth })).status, 405);
  });

  it("maps unknown containers, unreadable log drivers and oversized output to errors", async () => {
    const nf = await get(`/api/v1/containers/${"c".repeat(64)}/logs`);
    assert.equal(nf.status, 404);
    assert.equal(((await nf.json()) as any).error.code, "CONTAINER_NOT_FOUND");
    const none = await get(`/api/v1/containers/${NONE}/logs`);
    assert.equal(none.status, 502);
    const nb = (await none.json()) as any;
    assert.equal(nb.error.code, "PODMAN_API_ERROR");
    assert.match(nb.error.message, /none' log driver/);
    const big = await get(`/api/v1/containers/${BIG}/logs`);
    assert.equal(big.status, 502);
    assert.equal(((await big.json()) as any).error.code, "LOGS_TOO_LARGE");
  });
});
