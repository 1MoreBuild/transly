import assert from "node:assert/strict";
import test from "node:test";
import { createTranslationService } from "./translation-service.js";

const config = {
  apiUrl: "http://127.0.0.1:8787/v1",
  apiKey: "test",
  model: "test-model",
  protocol: "responses"
};

test("translation service streams completed passages and caches the final result", async () => {
  let modelRequests = 0;
  const progress = [];
  const memory = new Map();
  const service = createTranslationService({
    requestModel: async (_config, _request, options) => {
      modelRequests++;
      options.onTextDelta('["你好",');
      options.onTextDelta('"世界"]');
      return { outputText: '["你好","世界"]' };
    },
    cache: {
      async get(key) {
        return memory.has(key) ? { hit: true, value: memory.get(key) } : { hit: false };
      },
      async set(key, value) {
        memory.set(key, value);
      }
    }
  });
  const payload = {
    mode: "article",
    targetLanguage: "zh-CN",
    cacheKey: "same-page-batch",
    items: [
      { id: "article-1", text: "Hello" },
      { id: "article-2", text: "World" }
    ]
  };

  const first = await service.translate(payload, { config, onProgress: (event) => progress.push(event) });
  const second = await service.translate(payload, { config });
  assert.deepEqual(first, second);
  assert.equal(modelRequests, 1);
  assert.deepEqual(progress.flatMap((event) => event.items), [
    { id: "article-1", translation: "你好" },
    { id: "article-2", translation: "世界" }
  ]);
});
