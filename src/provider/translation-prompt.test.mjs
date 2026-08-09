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

test("article prompt prioritizes natural native-language translation", () => {
  const request = buildTranslationRequest(payload);
  assert.match(request.instructions, /native Simplified Chinese editorial translator/);
  assert.match(request.instructions, /Translate meaning rather than source-language sentence structure/);
  assert.match(request.instructions, /Avoid translationese, literal calques/);
  assert.match(request.instructions, /Render idioms and metaphors by their intended meaning/);
  assert.match(request.instructions, /terminology practitioners actually use/);
  assert.match(request.instructions, /direct, contemporary written Chinese/);
  assert.match(request.instructions, /never write '兔子洞'/);
  assert.match(request.instructions, /author's voice/);
  assert.match(request.prompt, /Full article prose/);
  assert.match(request.prompt, /\n\n<<<TRANSLY_PASSAGE_BREAK>>>\n\n/);
});

test("translation input excludes transport ids and page metadata", () => {
  const request = buildTranslationRequest(payload);
  assert.doesNotMatch(request.prompt, /article-1|article-2/);
  assert.doesNotMatch(request.prompt, /example\.com/);
  assert.doesNotMatch(request.prompt, /Items JSON|JSON shape|placeholder integrity/i);
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

test("placeholder repair adds only a compact structural reminder", () => {
  const request = buildTranslationRequest({ ...payload, placeholderRepair: true });
  assert.match(request.instructions, /repair retry/);
  assert.match(request.instructions, /appears exactly once/);
  assert.doesNotMatch(request.prompt, /placeholderRepair|article-1|example\.com/);
});

test("subtitle prompt translates semantic groups and aligns them back to timed cues", () => {
  const request = buildTranslationRequest({
    ...payload,
    mode: "subtitle",
    context: "A complete transcript that establishes names and references.",
    items: [
      { id: "cue-1", text: "Welcome to the conference,", subtitleGroup: 1 },
      { id: "cue-2", text: "where builders share their work.", subtitleGroup: 1 },
      { id: "cue-3", text: "Now let's begin.", subtitleGroup: 2 }
    ]
  });

  assert.match(request.instructions, /spoken Simplified Chinese/);
  assert.match(request.instructions, /video metadata and transcript context only to understand meaning/);
  assert.match(request.instructions, /Never translate, copy, summarize, or otherwise include context/);
  assert.match(request.instructions, /understand each complete group as one utterance/);
  assert.match(request.instructions, /distribute its translation back across that group's timed cues/);
  assert.match(request.instructions, /never move meaning across groups/);
  assert.match(request.prompt, /SUBTITLE GROUP SIZES\n2, 1/);
  assert.match(request.prompt, /complete transcript/);
  assert.doesNotMatch(request.prompt, /cue-1|cue-2|cue-3/);
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
