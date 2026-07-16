import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./article-progress.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { selectRenderableProgressItems } = context.TranslyArticleProgress;

test("accepts complete paragraph translations with exact placeholders", () => {
  const result = selectRenderableProgressItems([
    { id: "article-1", text: "Read [[TRANSLY_PH_0]] docs [[TRANSLY_PH_1]]." }
  ], [
    { id: "article-1", translation: "阅读 [[TRANSLY_PH_0]] 文档 [[TRANSLY_PH_1]]。" }
  ]);

  assert.deepEqual(toPlain(result), [
    { id: "article-1", translation: "阅读 [[TRANSLY_PH_0]] 文档 [[TRANSLY_PH_1]]。" }
  ]);
});

test("rejects streamed paragraphs with missing, extra, or duplicated placeholders", () => {
  const sourceItems = [{ id: "article-1", text: "Use [[TRANSLY_PH_0]] here." }];
  assert.deepEqual(toPlain(selectRenderableProgressItems(sourceItems, [
    { id: "article-1", translation: "在这里使用。" }
  ])), []);
  assert.deepEqual(toPlain(selectRenderableProgressItems(sourceItems, [
    { id: "article-1", translation: "使用 [[TRANSLY_PH_0]] [[TRANSLY_PH_1]]。" }
  ])), []);
  assert.deepEqual(toPlain(selectRenderableProgressItems(sourceItems, [
    { id: "article-1", translation: "使用 [[TRANSLY_PH_0]] [[TRANSLY_PH_0]]。" }
  ])), []);
});

test("ignores unknown ids, empty text, and duplicate progress items", () => {
  const result = selectRenderableProgressItems([
    { id: "article-1", text: "Hello" }
  ], [
    { id: "unknown", translation: "忽略" },
    { id: "article-1", translation: "  " },
    { id: "article-1", translation: "你好" },
    { id: "article-1", translation: "重复" }
  ]);

  assert.deepEqual(toPlain(result), [{ id: "article-1", translation: "你好" }]);
});

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}
