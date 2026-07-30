import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonOutput } from "./json-output.js";

test("JSON output parser accepts clean, fenced, and surrounded JSON", () => {
  assert.deepEqual(parseJsonOutput('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parseJsonOutput('```json\n{"items":[]}\n```'), { items: [] });
  assert.deepEqual(parseJsonOutput('Result: ["a"] done'), ["a"]);
});

test("JSON output parser rejects empty and non-JSON output", () => {
  assert.throws(() => parseJsonOutput(""), /empty output/);
  assert.throws(() => parseJsonOutput("not json"), /invalid JSON/);
});
