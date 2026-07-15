import assert from "node:assert/strict";
import test from "node:test";
import { createStreamingItemsParser, createStreamingStringArrayParser } from "./stream-items.mjs";

test("streaming item parser emits only completed JSON items", () => {
  const parser = createStreamingItemsParser();
  const chunks = [
    '{"items":[{"id":"one","trans',
    'lation":"第一段 {内容}"},{"id":"two",',
    '"translation":"包含 \\"引号\\" 的第二段"}',
    ']}'
  ];

  assert.deepEqual(parser.push(chunks[0]), []);
  assert.deepEqual(parser.push(chunks[1]), [{ id: "one", translation: "第一段 {内容}" }]);
  assert.deepEqual(parser.push(chunks[2]), [{ id: "two", translation: '包含 "引号" 的第二段' }]);
  assert.deepEqual(parser.push(chunks[3]), []);
});

test("streaming item parser handles the items key split across chunks", () => {
  const parser = createStreamingItemsParser();
  assert.deepEqual(parser.push('{"ite'), []);
  assert.deepEqual(parser.push('ms" : ['), []);
  assert.deepEqual(parser.push('{"id":"one","translation":"ok"}]}'), [
    { id: "one", translation: "ok" }
  ]);
});

test("streaming string array parser maps completed strings to ids", () => {
  const parser = createStreamingStringArrayParser(["one", "two"]);
  assert.deepEqual(parser.push('["第一'), []);
  assert.deepEqual(parser.push('段 {内容}","包含 \\"引'), [
    { id: "one", translation: "第一段 {内容}" }
  ]);
  assert.deepEqual(parser.push('号\\" 的第二段"]'), [
    { id: "two", translation: '包含 "引号" 的第二段' }
  ]);
});
