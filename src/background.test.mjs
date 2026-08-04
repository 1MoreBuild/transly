import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSettings, registerBackground } from "./background.js";

test("legacy subtitle font scales migrate to explicit pixel sizes", () => {
  const settings = normalizeSettings({
    subtitleSourceFontScale: 0.75,
    subtitleTranslationFontScale: 1.25
  });

  assert.equal(settings.subtitleSourceFontSizePx, 23);
  assert.equal(settings.subtitleTranslationFontSizePx, 38);
});

test("translation progress is relayed to the requesting tab and frame", async (t) => {
  let runtimeListener;
  let relayedMessage;
  const provider = {
    apiUrl: "http://127.0.0.1:8787/v1",
    apiKey: "local-test-key",
    model: "test-model",
    protocol: "auto"
  };
  const chrome = {
    runtime: {
      id: "transly-test",
      lastError: null,
      getURL(path) {
        return `chrome-extension://transly-test/${path}`;
      },
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        }
      }
    },
    storage: {
      local: {
        setAccessLevel() {
          return Promise.resolve();
        },
        get(_defaults, callback) {
          callback({ translationProvider: provider });
        },
        set(_value, callback) {
          callback();
        }
      },
      sync: { get() {}, set() {} }
    },
    tabs: {
      sendMessage(...args) {
        relayedMessage = args;
        args.at(-1)?.();
      }
    }
  };
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  registerBackground(chrome, {
    service: {
      async translate(_payload, context) {
        context.onProgress({
          type: "translation-items",
          mode: "article",
          items: [{ id: "article-1", translation: "你好" }]
        });
        return { items: [{ id: "article-1", translation: "你好" }] };
      }
    }
  });

  const response = new Promise((resolve) => {
    const keepChannelOpen = runtimeListener({
      type: "TRANSLY_TRANSLATE",
      payload: {
        mode: "article",
        targetLanguage: "zh-CN",
        items: [{ id: "article-1", text: "Hello" }]
      }
    }, {
      id: "transly-test",
      tab: { id: 42 },
      frameId: 7
    }, resolve);
    assert.equal(keepChannelOpen, true);
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(relayedMessage[0], 42);
  assert.deepEqual(relayedMessage[1], {
    type: "TRANSLY_TRANSLATION_PROGRESS",
    data: {
      type: "translation-items",
      mode: "article",
      items: [{ id: "article-1", translation: "你好" }]
    }
  });
  assert.deepEqual(relayedMessage[2], { frameId: 7 });
  assert.deepEqual(await response, {
    ok: true,
    data: { items: [{ id: "article-1", translation: "你好" }] }
  });
});

test("options page can discover providers and load their model names", async (t) => {
  let runtimeListener;
  let listedConfig;
  let discoveryCalls = 0;
  const chrome = {
    runtime: {
      id: "transly-test",
      lastError: null,
      getURL(path) {
        return `chrome-extension://transly-test/${path}`;
      },
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        }
      }
    },
    storage: {
      local: { setAccessLevel() { return Promise.resolve(); } },
      sync: {}
    },
    tabs: {}
  };
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);

  registerBackground(chrome, {
    listProviderModels: async (config) => {
      listedConfig = config;
      return { ok: true, models: ["model-a", "model-b"], modelCount: 2 };
    },
    discoverLocalProviders: async () => {
      discoveryCalls += 1;
      return [{
        apiUrl: "http://127.0.0.1:8317/v1",
        hint: "CLIProxyAPI",
        authRequired: false,
        models: ["model-a"]
      }];
    }
  });

  const sender = {
    id: "transly-test",
    url: "chrome-extension://transly-test/options.html"
  };
  const models = await dispatch(runtimeListener, {
    type: "TRANSLY_LIST_PROVIDER_MODELS",
    payload: {
      apiUrl: "http://127.0.0.1:8317/v1",
      apiKey: "client-key",
      protocol: "auto"
    }
  }, sender);
  assert.deepEqual(listedConfig, {
    apiUrl: "http://127.0.0.1:8317/v1",
    apiKey: "client-key",
    model: "",
    protocol: "auto"
  });
  assert.deepEqual(models, {
    ok: true,
    data: { ok: true, models: ["model-a", "model-b"], modelCount: 2 }
  });

  const discovered = await dispatch(runtimeListener, {
    type: "TRANSLY_DISCOVER_LOCAL_PROVIDERS"
  }, sender);
  assert.equal(discoveryCalls, 1);
  assert.equal(discovered.data[0].hint, "CLIProxyAPI");

  assert.equal(runtimeListener({
    type: "TRANSLY_DISCOVER_LOCAL_PROVIDERS"
  }, {
    id: "transly-test",
    url: "https://example.com/"
  }, () => {}), false);
});

test("provider status automatically connects Lane only when no provider is configured", async (t) => {
  let runtimeListener;
  let stored;
  let laneCalls = 0;
  const chrome = {
    runtime: {
      id: "transly-test",
      lastError: null,
      getURL(path) {
        return `chrome-extension://transly-test/${path}`;
      },
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        }
      }
    },
    storage: {
      local: {
        setAccessLevel() {
          return Promise.resolve();
        },
        get(_defaults, callback) {
          callback({ translationProvider: stored || {} });
        },
        set(value, callback) {
          stored = value.translationProvider;
          callback();
        }
      },
      sync: {}
    },
    tabs: {}
  };
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);
  registerBackground(chrome, {
    testProvider: async () => ({ ok: true, models: ["lane/model"] }),
    connectLane: async () => {
      laneCalls += 1;
      return {
        config: {
          apiUrl: "http://127.0.0.1:3210/v1",
          apiKey: "lane-key",
          model: "lane/model",
          protocol: "responses"
        },
        models: ["lane/model"]
      };
    }
  });
  const sender = {
    id: "transly-test",
    url: "chrome-extension://transly-test/popup.html"
  };
  const first = await dispatch(runtimeListener, { type: "TRANSLY_PROVIDER_STATUS" }, sender);
  const second = await dispatch(runtimeListener, { type: "TRANSLY_PROVIDER_STATUS" }, sender);
  assert.equal(laneCalls, 1);
  assert.equal(first.data.model, "lane/model");
  assert.equal(second.data.model, "lane/model");
  assert.equal(first.data.available, true);
  assert.equal(second.data.available, true);
  assert.equal(first.data.apiKey, undefined);
});

test("provider status distinguishes saved configuration from current availability", async (t) => {
  let runtimeListener;
  const provider = {
    apiUrl: "http://127.0.0.1:3210/v1",
    apiKey: "lane-key",
    model: "lane/model",
    protocol: "responses"
  };
  const chrome = {
    runtime: {
      id: "transly-test",
      lastError: null,
      getURL(path) {
        return `chrome-extension://transly-test/${path}`;
      },
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        }
      }
    },
    storage: {
      local: {
        setAccessLevel() {
          return Promise.resolve();
        },
        get(_defaults, callback) {
          callback({ translationProvider: provider });
        }
      },
      sync: {}
    },
    tabs: {}
  };
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);
  registerBackground(chrome, {
    testProvider: async (_config, options) => {
      assert.equal(options.timeoutMs, 3_000);
      throw new Error("fetch failed");
    }
  });

  const response = await dispatch(runtimeListener, {
    type: "TRANSLY_PROVIDER_STATUS"
  }, {
    id: "transly-test",
    url: "chrome-extension://transly-test/popup.html"
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.configured, true);
  assert.equal(response.data.available, false);
  assert.equal(response.data.model, "lane/model");
  assert.match(response.data.error, /fetch failed/);
  assert.equal(response.data.apiKey, undefined);
});

test("popup can list and switch configured models without reading the API key", async (t) => {
  let runtimeListener;
  let stored = {
    apiUrl: "http://127.0.0.1:3210/v1",
    apiKey: "lane-secret",
    model: "openai-codex/gpt-5.6-sol",
    protocol: "responses"
  };
  let listedConfig;
  const chrome = {
    runtime: {
      id: "transly-test",
      lastError: null,
      getURL(path) {
        return `chrome-extension://transly-test/${path}`;
      },
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        }
      }
    },
    storage: {
      local: {
        setAccessLevel() {
          return Promise.resolve();
        },
        get(_defaults, callback) {
          callback({ translationProvider: stored });
        },
        set(value, callback) {
          stored = value.translationProvider;
          callback();
        }
      },
      sync: {}
    },
    tabs: {}
  };
  globalThis.chrome = chrome;
  t.after(() => delete globalThis.chrome);
  registerBackground(chrome, {
    listProviderModels: async (config) => {
      listedConfig = config;
      return {
        models: [
          "openai-codex/gpt-5.6-sol",
          "openai-codex/gpt-5.6-luna"
        ]
      };
    }
  });
  const sender = {
    id: "transly-test",
    url: "chrome-extension://transly-test/popup.html"
  };

  const listed = await dispatch(runtimeListener, {
    type: "TRANSLY_LIST_CONFIGURED_MODELS"
  }, sender);
  assert.equal(listedConfig.apiKey, "lane-secret");
  assert.equal(listed.data.apiKey, undefined);
  assert.equal(listed.data.summary.apiKey, undefined);
  assert.deepEqual(listed.data.models, [
    "openai-codex/gpt-5.6-sol",
    "openai-codex/gpt-5.6-luna"
  ]);

  const selected = await dispatch(runtimeListener, {
    type: "TRANSLY_SELECT_PROVIDER_MODEL",
    model: "openai-codex/gpt-5.6-luna"
  }, sender);
  assert.equal(selected.data.model, "openai-codex/gpt-5.6-luna");
  assert.equal(stored.model, "openai-codex/gpt-5.6-luna");
  assert.equal(stored.apiKey, "lane-secret");
});

function dispatch(listener, message, sender) {
  return new Promise((resolve) => {
    assert.equal(listener(message, sender, resolve), true);
  });
}
