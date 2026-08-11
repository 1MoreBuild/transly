import assert from "node:assert/strict";
import test from "node:test";
import { buildTranslationRequest, normalizeTranslationResult } from "./translation-prompt.js";

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

test("translation input excludes transport ids and page metadata", () => {
  const request = buildTranslationRequest(payload);
  assert.doesNotMatch(request.prompt, /article-1|article-2/);
  assert.doesNotMatch(request.prompt, /example\.com/);
  assert.doesNotMatch(request.prompt, /Items JSON|JSON shape|placeholder integrity/i);
});

test("article instructions retain the editorial translation contract", () => {
  const { instructions, prompt } = buildTranslationRequest(payload);
  assert.match(instructions, /native Simplified Chinese editorial translator/i);
  assert.match(instructions, /Translate meaning rather than source-language sentence structure/i);
  assert.match(instructions, /Preserve facts, nuance, emphasis, tone, and the author's voice/i);
  assert.match(instructions, /terminology practitioners actually use/i);
  assert.match(instructions, /silently edit every passage as a native Simplified Chinese editor/i);
  assert.match(prompt, /CONTEXT\nBetter Models: Worse Tools/);
});

test("passage separator cannot collide with article text", () => {
  const request = buildTranslationRequest({
    ...payload,
    items: [
      { id: "article-1", text: "A literal <<<TRANSLY_PASSAGE_BREAK>>> example." },
      { id: "article-2", text: "Second passage." }
    ]
  });
  assert.match(request.instructions, /<<<TRANSLY_PASSAGE_BREAK>>>_/);
  assert.match(request.prompt, /\n\n<<<TRANSLY_PASSAGE_BREAK>>>_\n\n/);
  assert.equal(
    request.prompt.match(/\n\n<<<TRANSLY_PASSAGE_BREAK>>>_\n\n/g)?.length,
    1
  );
});

test("array translations map back to internal ids and reject malformed output", () => {
  assert.deepEqual(normalizeTranslationResult(["更好的模型：更差的工具", "一个奇怪的问题让我越挖越深。"], payload), {
    items: [
      { id: "article-1", translation: "更好的模型：更差的工具" },
      { id: "article-2", translation: "一个奇怪的问题让我越挖越深。" }
    ]
  });
  assert.throws(() => normalizeTranslationResult(["只有一条"], payload), /expected 2, received 1/);
  assert.throws(() => normalizeTranslationResult(["有效译文", ""], payload), /Invalid or empty translation/);
});
