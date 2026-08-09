import assert from "node:assert/strict";
import test from "node:test";
import { createResponseCache, hashCacheIdentity } from "./response-cache.js";

test("cache identities are stable across object key order and sensitive to values", async () => {
  const first = await hashCacheIdentity({ model: "test", request: { text: "Hello", language: "zh-CN" } });
  const reordered = await hashCacheIdentity({ request: { language: "zh-CN", text: "Hello" }, model: "test" });
  const changed = await hashCacheIdentity({ model: "test", request: { text: "World", language: "zh-CN" } });

  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("response cache stores and restores cloned JSON responses", async () => {
  const memory = createMemoryCacheStorage();
  const cache = createResponseCache(memory.storage);
  const value = { items: [{ id: "article-1", translation: "你好" }] };

  assert.equal(await cache.set("article-key", value), true);
  assert.deepEqual(await cache.get("article-key"), { hit: true, value });
  assert.deepEqual(await cache.get("missing-key"), { hit: false, value: null });
  assert.equal(memory.openedNames[0], "transly-translation-responses-v2");
});

test("response cache deletes expired and malformed entries", async () => {
  const memory = createMemoryCacheStorage(new Map([
    [cacheUrl("expired"), jsonResponse({
      createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      value: { items: [] }
    })],
    [cacheUrl("malformed"), new Response("not json")]
  ]));
  const cache = createResponseCache(memory.storage);

  assert.deepEqual(await cache.get("expired"), { hit: false, value: null });
  assert.deepEqual(await cache.get("malformed"), { hit: false, value: null });
  assert.deepEqual(memory.deleted.sort(), [cacheUrl("expired"), cacheUrl("malformed")]);
});

function createMemoryCacheStorage(seed = new Map()) {
  const entries = new Map([...seed].map(([key, response]) => [key, response.clone()]));
  const deleted = [];
  const openedNames = [];
  const cache = {
    async match(request) {
      return entries.get(request.url)?.clone() || null;
    },
    async put(request, response) {
      entries.set(request.url, response.clone());
    },
    async delete(request) {
      deleted.push(request.url);
      return entries.delete(request.url);
    },
    async keys() {
      return [...entries.keys()].map((url) => new Request(url));
    }
  };
  return {
    entries,
    deleted,
    openedNames,
    storage: {
      async open(name) {
        openedNames.push(name);
        return cache;
      }
    }
  };
}

function cacheUrl(key) {
  return `https://transly-cache.invalid/${key}`;
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" }
  });
}
