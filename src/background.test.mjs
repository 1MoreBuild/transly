import assert from "node:assert/strict";
import test from "node:test";
import { registerBackground } from "./background.js";

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
  assert.equal(first.data.apiKey, undefined);
});

function dispatch(listener, message, sender) {
  return new Promise((resolve) => {
    assert.equal(listener(message, sender, resolve), true);
  });
}
