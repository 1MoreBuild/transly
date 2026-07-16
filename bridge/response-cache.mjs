import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const CACHE_RECORD_VERSION = 1;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

export function hashCacheIdentity(identity) {
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function createResponseCache(options = {}) {
  const rootDir = options.rootDir
    || process.env.TRANSLY_CACHE_DIR
    || path.join(os.homedir(), "Library", "Caches", "Transly", "responses");
  const ttlMs = positiveNumber(options.ttlMs, DEFAULT_TTL_MS);
  const maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const now = typeof options.now === "function" ? options.now : Date.now;
  let prunePromise = null;
  let hasPruned = false;
  let writesSincePrune = 0;

  return Object.freeze({
    rootDir,

    async get(identityKey) {
      const { digest, file } = cacheFile(rootDir, identityKey);
      let record;
      try {
        record = JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return { hit: false, value: null };
        await rm(file, { force: true }).catch(() => {});
        return { hit: false, value: null };
      }

      const createdAt = Number(record?.createdAt);
      const valid = record?.version === CACHE_RECORD_VERSION
        && record?.key === digest
        && Number.isFinite(createdAt)
        && now() - createdAt <= ttlMs
        && record.value != null;
      if (!valid) {
        await rm(file, { force: true }).catch(() => {});
        return { hit: false, value: null };
      }
      return { hit: true, value: record.value };
    },

    async set(identityKey, value) {
      const { digest, directory, file } = cacheFile(rootDir, identityKey);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
      const record = {
        version: CACHE_RECORD_VERSION,
        key: digest,
        createdAt: now(),
        value
      };
      await writeFile(temporary, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      await rename(temporary, file);

      writesSincePrune++;
      if (!prunePromise && (!hasPruned || writesSincePrune >= 50)) {
        prunePromise = pruneCache(rootDir, { maxEntries, ttlMs, now })
          .then(() => {
            hasPruned = true;
            writesSincePrune = 0;
          })
          .finally(() => { prunePromise = null; });
      }
      if (prunePromise) await prunePromise;
      return true;
    }
  });
}

function cacheFile(rootDir, identityKey) {
  const digest = createHash("sha256").update(String(identityKey || "")).digest("hex");
  const directory = path.join(rootDir, digest.slice(0, 2));
  return {
    digest,
    directory,
    file: path.join(directory, `${digest}.json`)
  };
}

async function pruneCache(rootDir, options) {
  const files = await listCacheFiles(rootDir);
  const records = (await Promise.all(files.map(async (file) => {
    const info = await stat(file).catch(() => null);
    return info ? { file, modifiedAt: info.mtimeMs } : null;
  }))).filter(Boolean);
  const expiredBefore = options.now() - options.ttlMs;
  const expired = records.filter((record) => record.modifiedAt < expiredBefore);
  const remaining = records
    .filter((record) => record.modifiedAt >= expiredBefore)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  const overflow = remaining.slice(options.maxEntries);
  await Promise.all([...expired, ...overflow].map((record) => rm(record.file, { force: true })));
}

async function listCacheFiles(rootDir) {
  const directories = await readdir(rootDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const nested = await Promise.all(directories
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const directory = path.join(rootDir, entry.name);
      const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
      return files
        .filter((file) => file.isFile() && file.name.endsWith(".json"))
        .map((file) => path.join(directory, file.name));
    }));
  return nested.flat();
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  return Math.max(1, Math.round(positiveNumber(value, fallback)));
}
