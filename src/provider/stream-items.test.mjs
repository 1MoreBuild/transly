import assert from "node:assert/strict";
import test from "node:test";
import { createStreamingStringArrayParser } from "./stream-items.js";

test("streaming string array parser emits only complete strings in order", () => {
  const parser = createStreamingStringArrayParser(["a", "b"]);
  assert.deepEqual(parser.push('["hel'), []);
  assert.deepEqual(parser.push('lo", "wor'), [{ id: "a", translation: "hello" }]);
  assert.deepEqual(parser.push('ld"]'), [{ id: "b", translation: "world" }]);
});
