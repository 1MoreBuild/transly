import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const MODEL_REQUEST_TIMEOUT_MS = 180_000;
const OAUTH_REQUEST_TIMEOUT_MS = 30_000;
const RESPONSES_LITE_MODELS = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra"
]);
let refreshPromise = null;
let modelCatalogPromise = null;

export const DEFAULT_CODEX_CHATGPT_MODEL = "gpt-5.6-luna";

export async function translateViaCodexChatGpt(prompt, options = {}) {
  const credentials = await readFreshCodexCredentials();
  const accountId = resolveAccountId(credentials);
  const model = normalizeModel(options.model || DEFAULT_CODEX_CHATGPT_MODEL);
  const runtime = await resolveModelRuntime(model);
  const requestId = options.sessionId || randomUUID();
  const endpoint = resolveCodexUrl(options.baseUrl || process.env.TRANSLY_CODEX_BASE_URL);

  const body = {
    model,
    store: false,
    stream: true,
    instructions: "You are a precise translation engine. Return only the requested JSON.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }]
      }
    ],
    text: { verbosity: "low" },
    include: ["reasoning.encrypted_content"],
    parallel_tool_calls: true
  };

  if (runtime.responsesLite) {
    body.reasoning = { effort: runtime.reasoningEffort, context: "all_turns" };
    body.parallel_tool_calls = false;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildSseHeaders(credentials.access, accountId, requestId, runtime),
    body: JSON.stringify(body),
    signal: options.signal || AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    const text = await readResponseText(response, 16 * 1024);
    throw new Error(formatCodexError(response.status, response.statusText, text));
  }

  const parsed = await readCodexSse(response);
  return {
    model,
    endpoint,
    requestId,
    outputText: parsed.text,
    eventCount: parsed.eventCount,
    responseId: parsed.responseId,
    responseStatus: parsed.responseStatus
  };
}

export async function getCodexCredentialStatus() {
  const credentials = await readCodexCredentials();
  const accountId = credentials ? resolveAccountId(credentials) : null;
  return {
    available: Boolean(credentials?.access && credentials?.refresh && accountId),
    accountId: accountId ? `${accountId.slice(0, 8)}...` : null,
    expiresAt: credentials?.expires ? new Date(credentials.expires).toISOString() : null
  };
}

function normalizeModel(model) {
  return String(model || DEFAULT_CODEX_CHATGPT_MODEL).trim().toLowerCase();
}

function resolveCodexHome() {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME.replace(/^~/, os.homedir()))
    : path.join(os.homedir(), ".codex");
}

function resolveAuthPath() {
  return path.join(resolveCodexHome(), "auth.json");
}

async function readCodexCredentials() {
  const authPath = resolveAuthPath();
  let data;
  try {
    data = JSON.parse(await readFile(authPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read Codex auth file at ${authPath}: ${error.message}`);
  }

  const tokens = data?.tokens;
  if (!tokens || typeof tokens !== "object") {
    throw new Error(`Codex auth file at ${authPath} does not contain OAuth tokens.`);
  }

  const access = typeof tokens.access_token === "string" ? tokens.access_token : "";
  const refresh = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
  if (!access || !refresh) {
    throw new Error(`Codex auth file at ${authPath} is missing access_token or refresh_token.`);
  }

  return {
    authPath,
    raw: data,
    access,
    refresh,
    accountId: typeof tokens.account_id === "string" ? tokens.account_id : undefined,
    idToken: typeof tokens.id_token === "string" ? tokens.id_token : undefined,
    expires: decodeJwtExpiryMs(access)
  };
}

async function readFreshCodexCredentials() {
  const credentials = await readCodexCredentials();
  if (credentials.expires && credentials.expires - Date.now() > TOKEN_REFRESH_SKEW_MS) {
    return credentials;
  }
  if (!refreshPromise) {
    refreshPromise = refreshCodexCredentials(credentials).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function refreshCodexCredentials(credentials) {
  const latest = await readCodexCredentials();
  const source = latest.refresh !== credentials.refresh ? latest : credentials;
  if (source.expires && source.expires - Date.now() > TOKEN_REFRESH_SKEW_MS) return source;

  const response = await fetch(`${AUTH_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: source.refresh,
      client_id: CLIENT_ID
    }),
    signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS)
  });

  const bodyText = await readResponseText(response, 16 * 1024);
  if (!response.ok) {
    const disk = await readCodexCredentials().catch(() => null);
    if (disk?.refresh && disk.refresh !== source.refresh) return disk;
    throw new Error(formatCodexError(response.status, response.statusText, bodyText));
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error("OpenAI Codex token refresh returned non-JSON.");
  }

  const access = typeof body.access_token === "string" ? body.access_token : "";
  const refresh = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!access || !refresh) {
    throw new Error("OpenAI Codex token refresh response was missing OAuth tokens.");
  }

  const nextAccountId = decodeJwtPayload(access)?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  const sourceAccountId = resolveAccountId(source);
  if (nextAccountId && sourceAccountId && nextAccountId !== sourceAccountId) {
    throw new Error("OpenAI Codex token refresh returned credentials for a different account.");
  }

  const current = await readCodexCredentials();
  if (current.refresh !== source.refresh) return current;

  const nextRaw = {
    ...current.raw,
    tokens: {
      ...(current.raw.tokens || {}),
      access_token: access,
      refresh_token: refresh
    },
    last_refresh: new Date().toISOString()
  };
  await writeAuthAtomically(current.authPath, nextRaw);

  return {
    ...current,
    raw: nextRaw,
    access,
    refresh,
    accountId:
      typeof nextRaw.tokens.account_id === "string" ? nextRaw.tokens.account_id : current.accountId,
    idToken: typeof nextRaw.tokens.id_token === "string" ? nextRaw.tokens.id_token : current.idToken,
    expires: decodeJwtExpiryMs(access)
  };
}

async function writeAuthAtomically(authPath, value) {
  const temporary = `${authPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, authPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function resolveAccountId(credentials) {
  const claim = decodeJwtPayload(credentials.access)?.["https://api.openai.com/auth"];
  const jwtAccountId = claim && typeof claim === "object" ? claim.chatgpt_account_id : null;
  if (typeof credentials.accountId === "string" && credentials.accountId) return credentials.accountId;
  return typeof jwtAccountId === "string" && jwtAccountId ? jwtAccountId : null;
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function decodeJwtExpiryMs(token) {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
}

export function resolveCodexUrl(baseUrl) {
  const raw = String(baseUrl || DEFAULT_CODEX_BASE_URL).trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid Codex backend URL.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "chatgpt.com"
    || (parsed.port && parsed.port !== "443")
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("Codex OAuth requests are restricted to https://chatgpt.com.");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (!["/backend-api", "/backend-api/codex", "/backend-api/codex/responses"].includes(pathname)) {
    throw new Error("Codex backend URL must use the /backend-api path.");
  }
  return "https://chatgpt.com/backend-api/codex/responses";
}

function buildSseHeaders(token, accountId, requestId, runtime) {
  if (!accountId) {
    throw new Error("Failed to resolve ChatGPT account id from Codex credentials.");
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "chatgpt-account-id": accountId,
    originator: "codex_cli_rs",
    "User-Agent": `codex_cli_rs/${runtime.clientVersion} (${os.platform()} ${os.release()}; ${os.arch()})`,
    "OpenAI-Beta": "responses=experimental",
    accept: "text/event-stream",
    "content-type": "application/json",
    "session-id": requestId,
    "thread-id": requestId,
    "x-client-request-id": requestId
  };

  if (runtime.responsesLite) {
    headers["x-openai-internal-codex-responses-lite"] = "true";
  }

  return headers;
}

async function resolveModelRuntime(model) {
  const catalog = await readModelCatalog();
  const info = catalog?.models?.find((item) => normalizeModel(item?.slug) === model);
  return {
    responsesLite: typeof info?.use_responses_lite === "boolean"
      ? info.use_responses_lite
      : RESPONSES_LITE_MODELS.has(model),
    reasoningEffort: String(info?.default_reasoning_level || "medium"),
    clientVersion: String(catalog?.client_version || process.env.TRANSLY_CODEX_CLIENT_VERSION || "unknown")
  };
}

async function readModelCatalog() {
  if (!modelCatalogPromise) {
    const cachePath = path.join(resolveCodexHome(), "models_cache.json");
    modelCatalogPromise = readFile(cachePath, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
  }
  return modelCatalogPromise;
}

async function readCodexSse(response) {
  let eventCount = 0;
  let outputText = "";
  let responseId = null;
  let responseStatus = null;

  for await (const event of parseSse(response)) {
    eventCount++;
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "error") {
      throw new Error(`Codex error: ${event.message || event.code || JSON.stringify(event)}`);
    }
    if (type === "response.failed") {
      const err = event.response?.error;
      throw new Error(`Codex response failed: ${err?.message || err?.code || JSON.stringify(event)}`);
    }
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      outputText += event.delta;
    }
    if (event.response && typeof event.response === "object") {
      responseId = event.response.id || responseId;
      responseStatus = event.response.status || responseStatus;
      const finalText = extractTextFromResponse(event.response);
      if (finalText) outputText = finalText;
    }
  }

  return {
    text: outputText,
    eventCount,
    responseId,
    responseStatus
  };
}

async function* parseSse(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n")
          .trim();
        if (data && data !== "[DONE]") {
          yield JSON.parse(data);
        }
        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractTextFromResponse(response) {
  const output = response?.output;
  if (!Array.isArray(output)) return "";
  const texts = [];
  for (const item of output) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part?.text === "string") texts.push(part.text);
    }
  }
  return texts.join("");
}

async function readResponseText(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.byteLength > maxBytes - bytes ? value.subarray(0, maxBytes - bytes) : value;
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function formatCodexError(status, statusText, text) {
  try {
    const parsed = JSON.parse(text);
    const err = parsed?.error;
    if (err?.message) return `Codex request failed ${status}: ${err.message}`;
  } catch {}
  return `Codex request failed ${status}: ${text || statusText}`;
}
