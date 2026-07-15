import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_DIR = path.join(os.homedir(), "Library", "Logs", "Transly");
const LOG_PATH = process.env.TRANSLY_LOG_PATH || path.join(LOG_DIR, "native-host.jsonl");
let writeQueue = Promise.resolve();

export function diagnosticLogPath() {
  return LOG_PATH;
}

export function logDiagnostic(event, data = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    event,
    pid: process.pid,
    ...sanitizeDiagnostic(data)
  };

  writeQueue = writeQueue
    .catch(() => {})
    .then(() => appendRecord(record))
    .catch((error) => {
      process.stderr.write(`Transly diagnostic logging failed: ${error.message}\n`);
    });
  return writeQueue;
}

export async function flushDiagnostics() {
  await writeQueue.catch(() => {});
}

export function summarizeDiagnosticPayload(payload = {}) {
  return {
    clientRequestId: stringOrNull(payload.clientRequestId),
    mode: stringOrNull(payload.mode),
    phase: stringOrNull(payload.phase || payload.summary?.phase),
    targetLanguage: stringOrNull(payload.targetLanguage),
    batchIndex: finiteOrNull(payload.batchIndex),
    batchCount: finiteOrNull(payload.batchCount),
    sourceBlockCount: finiteOrNull(payload.sourceBlockCount),
    itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
    blockCount: Array.isArray(payload.blocks) ? payload.blocks.length : 0,
    totalTextChars: Array.isArray(payload.items)
      ? payload.items.reduce((sum, item) => sum + String(item?.text || "").length, 0)
      : 0,
    url: safeUrl(payload.url)
  };
}

async function appendRecord(record) {
  await mkdir(path.dirname(LOG_PATH), { recursive: true, mode: 0o700 });
  const info = await stat(LOG_PATH).catch(() => null);
  if (info?.size > MAX_LOG_BYTES) {
    const previous = `${LOG_PATH}.1`;
    await rm(previous, { force: true }).catch(() => {});
    await rename(LOG_PATH, previous).catch(() => {});
  }
  await appendFile(LOG_PATH, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

function sanitizeDiagnostic(value, key = "") {
  if (value == null) return value;
  if (isSensitiveDiagnosticKey(key)) return "[REDACTED]";
  if (/^(prompt|input|output|content|items|blocks)$/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDiagnostic(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, sanitizeDiagnostic(child, childKey)])
    );
  }
  return String(value).slice(0, 500);
}

export function isSensitiveDiagnosticKey(key) {
  const normalized = String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("secret") || normalized.includes("password") || normalized.includes("cookie")) return true;
  if (normalized === "authorization" || normalized.includes("apikey")) return true;
  return [
    "token",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "oauthtoken",
    "bearertoken",
    "authtoken"
  ].includes(normalized);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value.slice(0, 200) : null;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
