import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitCommand } from "../src/lib/shell-words";

describe("splitCommand", () => {
  it("splits on whitespace and keeps quoted parts together", () => {
    assert.deepEqual(splitCommand("nginx -g 'daemon off;'"), ["nginx", "-g", "daemon off;"]);
    assert.deepEqual(splitCommand('sh -c "echo \\"hi\\" there"'), ["sh", "-c", 'echo "hi" there']);
    assert.deepEqual(splitCommand("  a   b\tc  "), ["a", "b", "c"]);
    assert.deepEqual(splitCommand("a '' b"), ["a", "", "b"]);
    assert.deepEqual(splitCommand("x'y z'w"), ["xy zw"]);
  });
  it("returns an empty list for an empty line and null for an unclosed quote", () => {
    assert.deepEqual(splitCommand(""), []);
    assert.deepEqual(splitCommand("   "), []);
    assert.equal(splitCommand("a 'b"), null);
    assert.equal(splitCommand('a "b'), null);
  });
  it("does not interpret variables or pipes", () => {
    assert.deepEqual(splitCommand("echo $HOME | cat"), ["echo", "$HOME", "|", "cat"]);
  });
});
