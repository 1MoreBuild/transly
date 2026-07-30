const CACHE_NAME = "transly-translation-responses-v2";
const CACHE_ORIGIN = "https://transly-cache.invalid/";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
let writesSinceTrim = 0;

export async function hashCacheIdentity(value) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createResponseCache(cacheStorage = globalThis.caches) {
  return {
    async get(key) {
      if (!cacheStorage || !key) return { hit: false, value: null };
      const cache = await cacheStorage.open(CACHE_NAME);
      const response = await cache.match(cacheRequest(key));
      if (!response) return { hit: false, value: null };
      const entry = await response.json().catch(() => null);
      if (!entry || Date.now() - Number(entry.createdAt || 0) > MAX_AGE_MS) {
        await cache.delete(cacheRequest(key));
        return { hit: false, value: null };
      }
      return { hit: true, value: entry.value };
    },

    async set(key, value) {
      if (!cacheStorage || !key) return false;
      const cache = await cacheStorage.open(CACHE_NAME);
      await cache.put(cacheRequest(key), new Response(JSON.stringify({ createdAt: Date.now(), value }), {
        headers: { "content-type": "application/json" }
      }));
      writesSinceTrim++;
      if (writesSinceTrim >= 20) {
        writesSinceTrim = 0;
        await trimCache(cache);
      }
      return true;
    }
  };
}

function cacheRequest(key) {
  return new Request(`${CACHE_ORIGIN}${key}`);
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  const dated = await Promise.all(keys.map(async (request) => {
    const response = await cache.match(request);
    const entry = await response?.clone().json().catch(() => null);
    return { request, createdAt: Number(entry?.createdAt || 0) };
  }));
  dated.sort((left, right) => left.createdAt - right.createdAt);
  await Promise.all(dated.slice(0, dated.length - MAX_ENTRIES).map(({ request }) => cache.delete(request)));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
