import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonOutput } from "./json-output.mjs";

test("JSON output parser accepts clean arrays and objects", () => {
  assert.deepEqual(parseJsonOutput('["译文一","译文二"]'), ["译文一", "译文二"]);
  assert.deepEqual(parseJsonOutput('{"actions":[]}'), { actions: [] });
});

test("JSON output parser extracts arrays from fences and surrounding text", () => {
  assert.deepEqual(parseJsonOutput('```json\n["含有 [ 方括号","第二条"]\n```'), ["含有 [ 方括号", "第二条"]);
  assert.deepEqual(parseJsonOutput('Result:\n["第一条","第二条"]\nDone.'), ["第一条", "第二条"]);
});

test("JSON output parser rejects empty and non-JSON output", () => {
  assert.throws(() => parseJsonOutput(""), /empty output/);
  const privateOutput = "translation failed with private article text";
  assert.throws(
    () => parseJsonOutput(privateOutput),
    (error) => error.code === "INVALID_MODEL_OUTPUT" && !error.message.includes(privateOutput)
  );
});
