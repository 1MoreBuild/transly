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

test("translation service shares one model request across identical concurrent calls", async () => {
  let modelRequests = 0;
  let releaseRequest;
  let markRequestStarted;
  const requestStarted = new Promise((resolve) => {
    markRequestStarted = resolve;
  });
  const pendingResponse = new Promise((resolve) => {
    releaseRequest = () => resolve({ outputText: '["你好"]' });
  });
  const service = createTranslationService({
    requestModel: async () => {
      modelRequests++;
      markRequestStarted();
      return pendingResponse;
    },
    cache: {
      async get() {
        return { hit: false };
      },
      async set() {}
    }
  });
  const payload = {
    mode: "article",
    targetLanguage: "zh-CN",
    cacheKey: "same-concurrent-batch",
    items: [{ id: "article-1", text: "Hello" }]
  };

  const first = service.translate(payload, { config });
  const second = service.translate(payload, { config });
  await requestStarted;
  assert.equal(modelRequests, 1);

  releaseRequest();
  assert.deepEqual(await first, await second);
});

test("translation service repairs only passages with damaged placeholders", async () => {
  const requests = [];
  const service = createTranslationService({
    requestModel: async (_config, request) => {
      requests.push(request);
      return requests.length === 1
        ? { outputText: '["打开链接","世界"]' }
        : { outputText: '["打开 [[TRANSLY_PH_0]] 链接"]' };
    }
  });
  const result = await service.translate({
    mode: "article",
    targetLanguage: "zh-CN",
    items: [
      { id: "article-1", text: "Open [[TRANSLY_PH_0]] link" },
      { id: "article-2", text: "World" }
    ]
  }, { config });

  assert.equal(requests.length, 2);
  assert.match(requests[1].instructions, /repair retry/);
  assert.deepEqual(result, {
    items: [
      { id: "article-1", translation: "打开 [[TRANSLY_PH_0]] 链接" },
      { id: "article-2", translation: "世界" }
    ]
  });
});

test("translation service audits known blocks and caches normalized actions", async () => {
  let modelRequests = 0;
  const memory = new Map();
  const service = createTranslationService({
    requestModel: async () => {
      modelRequests++;
      return {
        outputText: JSON.stringify({
          actions: [
            { type: "retranslate", blockId: "block-1", confidence: "0.8", reason: "Lost a link" },
            { type: "delete", blockId: "block-1", confidence: 1, reason: "Not allowed" },
            { type: "ignore", blockId: "unknown", confidence: 1, reason: "Unknown id" }
          ],
          notes: ["Checked visible content", 42]
        })
      };
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
    targetLanguage: "zh-CN",
    auditKey: "article-audit",
    blocks: [{ id: "block-1", textSample: "Hello", textChars: 5 }]
  };

  const first = await service.audit(payload, { config });
  const second = await service.audit(payload, { config });

  assert.equal(modelRequests, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    actions: [{
      type: "retranslate",
      blockId: "block-1",
      confidence: 0.8,
      reason: "Lost a link"
    }],
    notes: ["Checked visible content", "42"]
  });
});

test("translation service validates requests before calling a model", async () => {
  let modelRequests = 0;
  const service = createTranslationService({
    requestModel: async () => {
      modelRequests++;
      return { outputText: "[]" };
    }
  });

  await assert.rejects(
    service.translate({ mode: "article", targetLanguage: "zh-CN", items: [] }, { config }),
    /must contain 1 to 250 items/
  );
  await assert.rejects(
    service.translate({
      mode: "article",
      targetLanguage: "zh-CN",
      items: [
        { id: "duplicate", text: "One" },
        { id: "duplicate", text: "Two" }
      ]
    }, { config }),
    /IDs must be unique/
  );
  await assert.rejects(
    service.audit({ targetLanguage: "", blocks: [] }, { config }),
    /Invalid target language/
  );
  assert.equal(modelRequests, 0);
});
