import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createResponseCache, hashCacheIdentity } from "./response-cache.mjs";

const execFileAsync = promisify(execFile);

test("response cache survives across cache instances", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "transly-cache-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const identity = hashCacheIdentity({ model: "test", prompt: "hello" });
  const first = createResponseCache({ rootDir });
  const second = createResponseCache({ rootDir });

  await first.set(identity, { items: [{ id: "1", translation: "你好" }] });
  const cached = await second.get(identity);

  assert.equal(cached.hit, true);
  assert.deepEqual(cached.value, { items: [{ id: "1", translation: "你好" }] });
});

test("response cache survives across Node processes", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "transly-cache-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const moduleUrl = new URL("./response-cache.mjs", import.meta.url).href;
  const identity = hashCacheIdentity({ model: "test", prompt: "cross-process" });
  const createCache = `const cache = createResponseCache({ rootDir: ${JSON.stringify(rootDir)} });`;

  await execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { createResponseCache } from ${JSON.stringify(moduleUrl)}; ${createCache} await cache.set(${JSON.stringify(identity)}, { items: [{ id: "1", translation: "persisted" }] });`
  ]);
  const { stdout } = await execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { createResponseCache } from ${JSON.stringify(moduleUrl)}; ${createCache} process.stdout.write(JSON.stringify(await cache.get(${JSON.stringify(identity)})));`
  ]);

  assert.deepEqual(JSON.parse(stdout), {
    hit: true,
    value: { items: [{ id: "1", translation: "persisted" }] }
  });
});

test("response cache hashes keys into private files", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "transly-cache-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const cache = createResponseCache({ rootDir });

  await cache.set("../../source text must not become a path", { actions: [] });
  const prefixes = await readdir(rootDir);
  const files = await readdir(path.join(rootDir, prefixes[0]));
  const file = path.join(rootDir, prefixes[0], files[0]);
  const contents = await readFile(file, "utf8");
  const mode = (await stat(file)).mode & 0o777;

  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  assert.equal(contents.includes("source text must not become a path"), false);
  assert.equal(mode, 0o600);
});

test("response cache expires old entries", async (context) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "transly-cache-"));
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  let now = 1_000;
  const cache = createResponseCache({ rootDir, ttlMs: 100, now: () => now });

  await cache.set("expiring", { items: [] });
  now = 1_101;

  assert.deepEqual(await cache.get("expiring"), { hit: false, value: null });
});

test("cache identity changes with the effective model input", () => {
  const base = { kind: "translate", model: "model-a", ids: ["1"], prompt: "hello" };
  assert.equal(hashCacheIdentity(base), hashCacheIdentity({ ...base }));
  assert.notEqual(hashCacheIdentity(base), hashCacheIdentity({ ...base, model: "model-b" }));
  assert.notEqual(hashCacheIdentity(base), hashCacheIdentity({ ...base, prompt: "updated" }));
});
