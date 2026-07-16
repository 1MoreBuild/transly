import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./background.js", import.meta.url), "utf8");

test("translation progress is relayed to the requesting tab and frame", async () => {
  let runtimeListener;
  let nativeMessageListener;
  let postedNativeMessage;
  let relayedMessage;
  const port = {
    postMessage(message) {
      postedNativeMessage = message;
    },
    disconnect() {},
    onMessage: {
      addListener(listener) {
        nativeMessageListener = listener;
      }
    },
    onDisconnect: { addListener() {} }
  };
  const chrome = {
    runtime: {
      id: "transly-test",
      lastError: null,
      connectNative() {
        return port;
      },
      getURL(path) {
        return `chrome-extension://transly-test/${path}`;
      },
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        }
      }
    },
    storage: { sync: { get() {}, set() {} } },
    tabs: {
      sendMessage(...args) {
        relayedMessage = args;
        args.at(-1)?.();
      }
    }
  };
  vm.runInContext(source, vm.createContext({
    chrome,
    crypto: { randomUUID: () => "native-request-1" },
    clearTimeout() {},
    setTimeout: () => 1
  }));

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

  nativeMessageListener({
    protocolVersion: 1,
    id: postedNativeMessage.id,
    progress: true,
    data: {
      type: "translation-items",
      mode: "article",
      items: [{ id: "article-1", translation: "你好" }]
    }
  });

  assert.equal(relayedMessage[0], 42);
  assert.deepEqual(toPlain(relayedMessage[1]), {
    type: "TRANSLY_TRANSLATION_PROGRESS",
    data: {
      type: "translation-items",
      mode: "article",
      items: [{ id: "article-1", translation: "你好" }]
    }
  });
  assert.deepEqual(toPlain(relayedMessage[2]), { frameId: 7 });

  nativeMessageListener({
    protocolVersion: 1,
    id: postedNativeMessage.id,
    ok: true,
    data: { items: [{ id: "article-1", translation: "你好" }] }
  });
  assert.deepEqual(toPlain(await response), {
    ok: true,
    data: { items: [{ id: "article-1", translation: "你好" }] }
  });
});

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}
