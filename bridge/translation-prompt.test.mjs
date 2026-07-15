import assert from "node:assert/strict";
import test from "node:test";
import { buildTranslationRequest, normalizeTranslationResult } from "./translation-prompt.mjs";

const payload = {
  mode: "article",
  targetLanguage: "zh-CN",
  context: "Better Models: Worse Tools\n\nFull article prose.",
  url: "https://example.com/article",
  items: [
    { id: "article-1", text: "Better Models: Worse Tools" },
    { id: "article-2", text: "A strange issue sent me down a rabbit hole." }
  ]
};

test("article prompt prioritizes natural native-language translation", () => {
  const request = buildTranslationRequest(payload);
  assert.match(request.instructions, /native Simplified Chinese editorial translator/);
  assert.match(request.instructions, /Translate meaning rather than source-language sentence structure/);
  assert.match(request.instructions, /Avoid translationese, literal calques/);
  assert.match(request.instructions, /Render idioms and metaphors by their intended meaning/);
  assert.match(request.instructions, /replace it with a natural target-language expression/);
  assert.match(request.instructions, /terminology practitioners actually use/);
  assert.match(request.instructions, /do not translate every English term by force/);
  assert.match(request.instructions, /direct, contemporary written Chinese/);
  assert.match(request.instructions, /never write '兔子洞'/);
  assert.match(request.instructions, /silently edit every passage as a native Simplified Chinese editor/);
  assert.match(request.instructions, /author's voice/);
  assert.match(request.prompt, /Full article prose/);
  assert.match(request.prompt, /\n\n%%\n\n/);
});

test("translation input excludes transport ids and page metadata", () => {
  const request = buildTranslationRequest(payload);
  assert.doesNotMatch(request.prompt, /article-1|article-2/);
  assert.doesNotMatch(request.prompt, /example\.com/);
  assert.doesNotMatch(request.prompt, /Items JSON|JSON shape|placeholder integrity/i);
});

test("placeholder repair retry adds only a compact structural reminder", () => {
  const request = buildTranslationRequest({ ...payload, placeholderRepair: true });
  assert.match(request.instructions, /repair retry/);
  assert.match(request.instructions, /appears exactly once/);
  assert.doesNotMatch(request.prompt, /placeholderRepair|article-1|example\.com/);
});

test("array translations are mapped back to internal ids", () => {
  assert.deepEqual(normalizeTranslationResult(["更好的模型：更差的工具", "一个奇怪的问题让我越挖越深。"], payload), {
    items: [
      { id: "article-1", translation: "更好的模型：更差的工具" },
      { id: "article-2", translation: "一个奇怪的问题让我越挖越深。" }
    ]
  });
});

test("translation count mismatch is rejected", () => {
  assert.throws(
    () => normalizeTranslationResult(["只有一条"], payload),
    /expected 2, received 1/
  );
});

test("empty translations and duplicate legacy ids are rejected", () => {
  assert.throws(
    () => normalizeTranslationResult(["有效译文", ""], payload),
    /Invalid or empty translation/
  );
  assert.throws(
    () => normalizeTranslationResult({ items: [
      { id: "article-1", translation: "第一条" },
      { id: "article-1", translation: "重复" }
    ] }, payload),
    /item count mismatch/
  );
});
