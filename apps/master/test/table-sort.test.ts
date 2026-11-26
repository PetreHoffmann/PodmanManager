import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextSortFor, parseSortFor, sortHrefFor, sortRows, timeOf } from "../src/lib/table-sort";

const KEYS = ["name", "size"] as const;
type Row = { name: string; size: number | null };
const val = (r: Row, k: (typeof KEYS)[number]) => (k === "name" ? r.name : r.size);
const names = (l: Row[]) => l.map((r) => r.name);

describe("generic table sort", () => {
  it("parses only the given columns", () => {
    assert.deepEqual(parseSortFor(KEYS, "size", "desc"), { key: "size", dir: "desc" });
    assert.deepEqual(parseSortFor(KEYS, "name", "x"), { key: "name", dir: "asc" });
    assert.equal(parseSortFor(KEYS, "host", "asc"), null);
    assert.equal(parseSortFor(KEYS, undefined, undefined), null);
  });
  it("cycles ascending, descending, default", () => {
    assert.deepEqual(nextSortFor(null, "name"), { key: "name", dir: "asc" });
    assert.deepEqual(nextSortFor({ key: "name", dir: "asc" }, "name"), { key: "name", dir: "desc" });
    assert.equal(nextSortFor({ key: "name", dir: "desc" }, "name"), null);
    assert.deepEqual(nextSortFor({ key: "size", dir: "desc" }, "name"), { key: "name", dir: "asc" });
  });
  it("sorts naturally and numerically, missing values last, equal values keep their order", () => {
    const rows: Row[] = [{ name: "net-10", size: 5 }, { name: "net-2", size: null }, { name: "Net-1", size: 5 }, { name: "x", size: 1 }];
    assert.deepEqual(names(sortRows(rows, { key: "name", dir: "asc" }, val)), ["Net-1", "net-2", "net-10", "x"]);
    assert.deepEqual(names(sortRows(rows, { key: "size", dir: "asc" }, val)), ["x", "net-10", "Net-1", "net-2"]);
    assert.deepEqual(names(sortRows(rows, { key: "size", dir: "desc" }, val)), ["net-10", "Net-1", "x", "net-2"]);
    assert.deepEqual(names(sortRows(rows, null, val)), names(rows));
  });
  it("builds the link with the other parameters of the page", () => {
    assert.equal(sortHrefFor("/containers", { host: "2", status: "", q: "app" }, { key: "name", dir: "desc" }), "/containers?host=2&q=app&sort=name&dir=desc");
    assert.equal(sortHrefFor("/resources", { tab: "images" }, null), "/resources?tab=images");
    assert.equal(sortHrefFor("/pods", {}, null), "/pods");
  });
  it("reads times from ISO strings", () => {
    assert.equal(timeOf("2026-11-26T10:00:00Z"), Date.parse("2026-11-26T10:00:00Z"));
    assert.equal(timeOf(null), null);
    assert.equal(timeOf("nonsense"), null);
  });
});
