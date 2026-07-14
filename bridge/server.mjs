import {
  DEFAULT_CODEX_CHATGPT_MODEL,
  getCodexCredentialStatus,
  translateViaCodexChatGpt
} from "./codex-chatgpt.mjs";
import { loadLocalEnv } from "./env.mjs";
import {
  estimateUsage,
  initLangfuse,
  sanitize,
  shutdownLangfuse,
  startGeneration,
  traceSpan,
  withTranslateTrace
} from "./langfuse.mjs";

loadLocalEnv();
const langfuseStatus = await initLangfuse();

const CODEX_MODEL = process.env.TRANSLY_CODEX_MODEL || DEFAULT_CODEX_CHATGPT_MODEL;
const cache = new Map();

export async function handleServiceRequest(type, payload = {}) {
  if (type === "health") {
    const credentials = await getCodexCredentialStatus().catch((error) => ({
      available: false,
      error: String(error?.message || error)
    }));
    return {
      ok: true,
      provider: "codex-chatgpt-responses",
      model: CODEX_MODEL,
      langfuse: langfuseStatus.enabled,
      credentials
    };
  }

  if (type === "audit") {
    return handleAuditRequest({ ...payload, mode: "article-audit" });
  }

  if (type !== "translate") {
    const error = new Error(`Unsupported service request type: ${type}`);
    error.code = "UNSUPPORTED_REQUEST";
    throw error;
  }

  return withTranslateTrace(payload, async (trace) => {
    await traceSpan(trace, "validate-request", { input: summarizePayload(payload) }, async () => {
      validatePayload(payload);
      return { valid: true };
    });

    const cached = payload.cacheKey ? cache.get(payload.cacheKey) : null;
    await traceSpan(trace, "cache-lookup", {
      input: { cacheKey: payload.cacheKey || null },
      metadata: { cacheEnabled: Boolean(payload.cacheKey) }
    }, async () => ({ hit: Boolean(cached) }));

    if (cached) return cached;

    const translated = await translateWithChatGptCodex(payload, trace);
    if (payload.cacheKey) {
      cache.set(payload.cacheKey, translated);
      await traceSpan(trace, "cache-store", {
        input: { cacheKey: payload.cacheKey, itemCount: translated.items.length }
      }, async () => ({ stored: true }));
    }
    return translated;
  });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Missing JSON payload");
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error("Missing items");
  if (payload.items.length > 250) throw new Error("Too many translation items");
  if (typeof payload.targetLanguage !== "string" || !payload.targetLanguage || payload.targetLanguage.length > 40) {
    throw new Error("Invalid targetLanguage");
  }
  if (!["article", "subtitle"].includes(payload.mode)) throw new Error("Unsupported mode");
  let totalChars = 0;
  const ids = new Set();
  for (const item of payload.items) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 128 || ids.has(item.id)) {
      throw new Error("Invalid or duplicate item id");
    }
    if (typeof item.text !== "string" || !item.text) throw new Error("Invalid item text");
    ids.add(item.id);
    totalChars += item.text.length;
  }
  if (totalChars > 1_500_000) throw new Error("Translation text is too large");
}

function validateAuditPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Missing JSON payload");
  if (payload.mode !== "article-audit") throw new Error("Unsupported audit mode");
  if (!payload.targetLanguage) throw new Error("Missing targetLanguage");
  if (!Array.isArray(payload.blocks)) throw new Error("Missing blocks");
  if (payload.blocks.length > 120) throw new Error("Too many audit blocks");
}

async function handleAuditRequest(payload) {
  return withTranslateTrace(payload, async (trace) => {
    await traceSpan(trace, "validate-audit-request", {
      input: summarizeAuditPayload(payload)
    }, async () => {
      validateAuditPayload(payload);
      return { valid: true };
    });

    if (!payload.blocks.length) {
      return { actions: [], notes: ["No blocks to audit."] };
    }

    return auditArticleWithChatGptCodex(payload, trace);
  });
}

async function translateWithChatGptCodex(payload, trace) {
  const prompt = await traceSpan(trace, "build-prompt", {
    input: summarizePayload(payload),
    metadata: { mode: payload.mode, itemCount: payload.items.length }
  }, async () => buildPrompt(payload));

  const generation = startGeneration(trace, {
    model: CODEX_MODEL,
    input: prompt,
    metadata: {
      provider: "codex-chatgpt-responses",
      endpoint: "https://chatgpt.com/backend-api/codex/responses",
      mode: payload.mode,
      targetLanguage: payload.targetLanguage,
      itemCount: payload.items.length,
      sourceUrl: payload.url
    }
  });

  let raw = "";
  let responseMeta = {};
  try {
    const response = await translateViaCodexChatGpt(prompt, {
      model: CODEX_MODEL,
      sessionId: payload.cacheKey
    });
    raw = response.outputText;
    responseMeta = {
      requestId: response.requestId,
      responseId: response.responseId,
      responseStatus: response.responseStatus,
      eventCount: response.eventCount,
      rawOutputChars: raw.length
    };
    generation.update({
      output: sanitize(raw),
      usageDetails: estimateUsage(prompt, raw),
      metadata: { status: "ok", usageEstimated: true, ...responseMeta }
    }).end();
  } catch (error) {
    generation.update({
      level: "ERROR",
      output: { error: String(error?.message || error) },
      usageDetails: estimateUsage(prompt, ""),
      metadata: { status: "error", usageEstimated: true }
    }).end();
    throw error;
  }

  const parsed = await traceSpan(trace, "parse-codex-output", {
    input: sanitize(raw),
    metadata: responseMeta
  }, async () => parseJson(raw));

  const result = normalizeResult(parsed, payload);
  await traceSpan(trace, "normalize-translation-result", {
    input: sanitize(parsed),
    metadata: { requestedItemCount: payload.items.length }
  }, async () => ({
    outputItemCount: result.items.length,
    missingItemCount: payload.items.length - result.items.length
  }));

  return result;
}

function normalizeResult(parsed, payload) {
  const allowedIds = new Set(payload.items.map((item) => item.id));
  return {
      items: (parsed.items || [])
        .filter((item) => allowedIds.has(item.id))
        .map((item) => ({ id: item.id, translation: String(item.translation || "").trim() }))
  };
}

async function auditArticleWithChatGptCodex(payload, trace) {
  const prompt = await traceSpan(trace, "build-audit-prompt", {
    input: summarizeAuditPayload(payload),
    metadata: { blockCount: payload.blocks.length }
  }, async () => buildAuditPrompt(payload));

  const generation = startGeneration(trace, {
    model: CODEX_MODEL,
    input: prompt,
    metadata: {
      provider: "codex-chatgpt-responses",
      endpoint: "https://chatgpt.com/backend-api/codex/responses",
      mode: payload.mode,
      targetLanguage: payload.targetLanguage,
      blockCount: payload.blocks.length,
      sourceUrl: payload.url
    }
  });

  let raw = "";
  let responseMeta = {};
  try {
    const response = await translateViaCodexChatGpt(prompt, {
      model: CODEX_MODEL,
      sessionId: payload.auditKey || payload.url
    });
    raw = response.outputText;
    responseMeta = {
      requestId: response.requestId,
      responseId: response.responseId,
      responseStatus: response.responseStatus,
      eventCount: response.eventCount,
      rawOutputChars: raw.length
    };
    generation.update({
      output: sanitize(raw),
      usageDetails: estimateUsage(prompt, raw),
      metadata: { status: "ok", usageEstimated: true, ...responseMeta }
    }).end();
  } catch (error) {
    generation.update({
      level: "ERROR",
      output: { error: String(error?.message || error) },
      usageDetails: estimateUsage(prompt, ""),
      metadata: { status: "error", usageEstimated: true }
    }).end();
    throw error;
  }

  const parsed = await traceSpan(trace, "parse-audit-output", {
    input: sanitize(raw),
    metadata: responseMeta
  }, async () => parseJson(raw));

  const result = normalizeAuditResult(parsed, payload);
  await traceSpan(trace, "normalize-audit-result", {
    input: sanitize(parsed),
    metadata: { requestedBlockCount: payload.blocks.length }
  }, async () => ({
    actionCount: result.actions.length,
    actions: result.actions.map((action) => action.type)
  }));

  return result;
}

function normalizeAuditResult(parsed, payload) {
  const allowedIds = new Set(payload.blocks.map((block) => block.id));
  const allowedTypes = new Set(["translate_missing", "retranslate", "ignore", "needs_review"]);
  return {
    actions: (parsed.actions || [])
      .filter((action) => allowedIds.has(action.blockId) && allowedTypes.has(action.type))
      .map((action) => ({
        type: action.type,
        blockId: action.blockId,
        confidence: Number.isFinite(Number(action.confidence)) ? Number(action.confidence) : 0,
        reason: String(action.reason || "").slice(0, 500)
      })),
    notes: Array.isArray(parsed.notes) ? parsed.notes.map((note) => String(note).slice(0, 500)).slice(0, 8) : []
  };
}

function buildPrompt(payload) {
  const compactItems = payload.items.map((item) => ({ id: item.id, text: item.text }));
  const modeInstruction = payload.mode === "subtitle"
    ? "For subtitles, keep translations concise enough to read at playback speed."
    : [
        "For articles, translate as fluent written prose.",
        "Use the full context to resolve terminology, pronouns, chronology, and references.",
        "Some structural boundaries may appear as placeholder tokens; keep those tokens in the translated text at the matching boundary.",
        "Only translate the items listed in Items JSON; context is for meaning, not for output."
      ].join(" ");
  return [
    "You are a precise translation engine.",
    `Translate the ${payload.mode} items to ${payload.targetLanguage}.`,
    "Use the context to preserve terminology, pronouns, tone, and document-level meaning.",
    "Return only valid JSON. Do not include Markdown fences or commentary.",
    "The JSON shape must be: {\"items\":[{\"id\":\"...\",\"translation\":\"...\"}]}",
    "Keep the item count and ids unchanged. Do not merge, split, omit, or reorder items.",
    "Preserve placeholder tokens like [[TRANSLY_PH_0]] exactly. Do not translate, remove, renumber, or wrap them.",
    modeInstruction,
    "",
    "Context:",
    payload.context || "",
    "",
    "Items JSON:",
    JSON.stringify(compactItems)
  ].join("\n");
}

function buildAuditPrompt(payload) {
  const blocks = payload.blocks.map((block) => ({
    id: block.id,
    reason: block.reason,
    path: block.path,
    tag: block.tag,
    textSample: block.textSample,
    textChars: block.textChars,
    hasTranslation: block.hasTranslation,
    sourceLinkCount: block.sourceLinkCount,
    translationLinkCount: block.translationLinkCount,
    translationTextChars: block.translationTextChars,
    rect: block.rect,
    ancestorHints: block.ancestorHints
  }));

  return [
    "You are a webpage translation QA planner.",
    "You do not translate text. You only decide which visible text blocks need repair.",
    `Target language: ${payload.targetLanguage}.`,
    "Return only valid JSON. Do not include Markdown fences or commentary.",
    "The JSON shape must be: {\"actions\":[{\"type\":\"translate_missing|retranslate|ignore|needs_review\",\"blockId\":\"...\",\"confidence\":0.0,\"reason\":\"...\"}],\"notes\":[\"...\"]}",
    "",
    "Rules:",
    "- Use translate_missing only for visible article/body content that should have a translation but does not.",
    "- Use retranslate when the block already has a translation but it is likely broken, too short, or lost links.",
    "- Use ignore for navigation, subscribe/paywall widgets, buttons, comments metadata, recommendations, ads, labels, timestamps, and UI chrome.",
    "- Use needs_review if the sample is ambiguous.",
    "- Prefer precision over recall. Do not ask to translate UI controls just because they are visible.",
    "- Never invent block ids. Use only ids from Blocks JSON.",
    "",
    "Page summary:",
    JSON.stringify(sanitize(payload.summary || {})),
    "",
    "Blocks JSON:",
    JSON.stringify(blocks)
  ].join("\n");
}

function parseJson(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));

  throw new Error(`Codex returned non-JSON output: ${trimmed.slice(0, 300)}`);
}

function summarizePayload(payload) {
  return sanitize({
    mode: payload.mode,
    targetLanguage: payload.targetLanguage,
    url: payload.url,
    title: payload.title,
    itemCount: payload.items?.length || 0,
    totalTextChars: payload.items?.reduce((sum, item) => sum + String(item.text || "").length, 0) || 0,
    cacheKey: payload.cacheKey || null
  });
}

function summarizeAuditPayload(payload) {
  return sanitize({
    mode: payload.mode,
    targetLanguage: payload.targetLanguage,
    url: payload.url,
    title: payload.title,
    blockCount: payload.blocks?.length || 0,
    phase: payload.summary?.phase,
    auditKey: payload.auditKey || null
  });
}

export async function shutdownTranslationService() {
  await shutdownLangfuse();
}
