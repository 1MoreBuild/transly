import {
  DEFAULT_CODEX_CHATGPT_MODEL,
  getCodexCredentialStatus,
  translateViaCodexChatGpt
} from "./codex-chatgpt.mjs";
import { loadLocalEnv } from "./env.mjs";
import { logDiagnostic, summarizeDiagnosticPayload } from "./diagnostics.mjs";
import { parseJsonOutput } from "./json-output.mjs";
import { createStreamingStringArrayParser } from "./stream-items.mjs";
import { assertPlaceholderIntegrity, summarizePlaceholderIntegrity } from "./translation-quality.mjs";
import { buildTranslationRequest, normalizeTranslationResult } from "./translation-prompt.mjs";
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
const CODEX_REASONING_EFFORT = process.env.TRANSLY_REASONING_EFFORT || "medium";
const cache = new Map();
const inFlightTranslations = new Map();

export async function handleServiceRequest(type, payload = {}, context = {}) {
  if (type === "health") {
    const credentials = await getCodexCredentialStatus().catch((error) => ({
      available: false,
      error: String(error?.message || error)
    }));
    return {
      ok: true,
      provider: "codex-chatgpt-responses",
      model: CODEX_MODEL,
      reasoningEffort: CODEX_REASONING_EFFORT,
      langfuse: langfuseStatus.enabled,
      credentials
    };
  }

  if (type === "audit") {
    return handleAuditRequest({ ...payload, mode: "article-audit" }, context);
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
    const inFlight = payload.cacheKey ? inFlightTranslations.get(payload.cacheKey) : null;
    await traceSpan(trace, "cache-lookup", {
      input: { cacheKey: payload.cacheKey || null },
      metadata: { cacheEnabled: Boolean(payload.cacheKey) }
    }, async () => ({ hit: Boolean(cached), inFlight: Boolean(inFlight) }));

    await logDiagnostic("cache-lookup", {
      ...summarizeDiagnosticPayload(payload),
      hit: Boolean(cached),
      inFlight: Boolean(inFlight)
    });

    if (cached) return cached;
    if (inFlight) {
      return traceSpan(trace, "inflight-join", {
        metadata: { cacheEnabled: true }
      }, async () => inFlight);
    }

    const translation = translateWithChatGptCodex(payload, trace, context);
    if (payload.cacheKey) inFlightTranslations.set(payload.cacheKey, translation);
    try {
      const translated = await translation;
      if (payload.cacheKey) {
        cache.set(payload.cacheKey, translated);
        await traceSpan(trace, "cache-store", {
          input: { cacheKey: payload.cacheKey, itemCount: translated.items.length }
        }, async () => ({ stored: true }));
      }
      return translated;
    } finally {
      if (payload.cacheKey && inFlightTranslations.get(payload.cacheKey) === translation) {
        inFlightTranslations.delete(payload.cacheKey);
      }
    }
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

async function handleAuditRequest(payload, context) {
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

    return auditArticleWithChatGptCodex(payload, trace, context);
  });
}

async function translateWithChatGptCodex(payload, trace, context, attempt = 1) {
  const request = await traceSpan(trace, "build-prompt", {
    input: summarizePayload(payload),
    metadata: { mode: payload.mode, itemCount: payload.items.length }
  }, async () => buildTranslationRequest(payload));
  const { instructions, prompt } = request;
  const modelInput = `${instructions}\n\n${prompt}`;

  const generation = startGeneration(trace, {
    model: CODEX_MODEL,
    input: request,
    metadata: {
      provider: "codex-chatgpt-responses",
      endpoint: "https://chatgpt.com/backend-api/codex/responses",
      mode: payload.mode,
      phase: payload.phase,
      attempt,
      reasoningEffort: CODEX_REASONING_EFFORT,
      targetLanguage: payload.targetLanguage,
      itemCount: payload.items.length,
      sourceUrl: payload.url
    }
  });

  let raw = "";
  let responseMeta = {};
  const streamParser = createStreamingStringArrayParser(payload.items.map((item) => item.id));
  const modelStartedAt = Date.now();
  let firstStreamedItemMs = null;
  let streamedItemCount = 0;
  await logDiagnostic("model-request-start", {
    ...summarizeDiagnosticPayload(payload),
    model: CODEX_MODEL,
    reasoningEffort: CODEX_REASONING_EFFORT,
    promptChars: modelInput.length,
    contextChars: String(payload.context || "").length,
    translationChars: payload.items.reduce((sum, item) => sum + item.text.length, 0)
  });
  try {
    const response = await translateViaCodexChatGpt(prompt, {
      model: CODEX_MODEL,
      reasoningEffort: CODEX_REASONING_EFFORT,
      sessionId: payload.cacheKey,
      instructions,
      onTextDelta(delta) {
        const items = streamParser.push(delta)
          .filter((item) => typeof item.translation === "string")
          .map((item) => ({ id: item.id, translation: item.translation.trim() }));
        if (!items.length || typeof context.onProgress !== "function") return;
        if (firstStreamedItemMs == null) firstStreamedItemMs = Date.now() - modelStartedAt;
        streamedItemCount += items.length;
        context.onProgress({
          type: "translation-items",
          clientRequestId: payload.clientRequestId || null,
          mode: payload.mode,
          phase: payload.phase || null,
          batchIndex: payload.batchIndex || null,
          batchCount: payload.batchCount || null,
          items
        });
      }
    });
    raw = response.outputText;
    responseMeta = {
      requestId: response.requestId,
      responseId: response.responseId,
      responseStatus: response.responseStatus,
      reasoningEffort: response.reasoningEffort,
      eventCount: response.eventCount,
      rawOutputChars: raw.length,
      firstStreamedItemMs,
      streamedItemCount,
      ...response.timings
    };
    await logDiagnostic("model-request-complete", {
      ...summarizeDiagnosticPayload(payload),
      model: CODEX_MODEL,
      durationMs: Date.now() - modelStartedAt,
      ...responseMeta
    });
    generation.update({
      output: sanitize(raw),
      usageDetails: estimateUsage(modelInput, raw),
      metadata: { status: "ok", usageEstimated: true, ...responseMeta }
    }).end();
  } catch (error) {
    await logDiagnostic("model-request-error", {
      ...summarizeDiagnosticPayload(payload),
      model: CODEX_MODEL,
      durationMs: Date.now() - modelStartedAt,
      error: String(error?.message || error)
    });
    generation.update({
      level: "ERROR",
      output: { error: String(error?.message || error) },
      usageDetails: estimateUsage(modelInput, ""),
      metadata: { status: "error", usageEstimated: true }
    }).end();
    throw error;
  }

  const parsed = await traceSpan(trace, "parse-codex-output", {
    input: sanitize(raw),
    metadata: responseMeta
  }, async () => parseJsonOutput(raw));

  let result = normalizeTranslationResult(parsed, payload);
  let placeholderIntegrity = summarizePlaceholderIntegrity(payload.items, result.items);
  await logDiagnostic("translation-quality", {
    ...summarizeDiagnosticPayload(payload),
    attempt,
    ...placeholderIntegrity
  });
  if (placeholderIntegrity.affectedItemCount && attempt === 1) {
    const affectedIds = new Set(placeholderIntegrity.affectedItemIds);
    const repairPayload = {
      ...payload,
      phase: `${payload.phase || "translate"}-placeholder-repair`,
      cacheKey: null,
      placeholderRepair: true,
      items: payload.items.filter((item) => affectedIds.has(item.id))
    };
    await logDiagnostic("translation-placeholder-retry", {
      ...summarizeDiagnosticPayload(repairPayload),
      missingTokenCount: placeholderIntegrity.missingTokenCount,
      extraTokenCount: placeholderIntegrity.extraTokenCount
    });
    const repaired = await translateWithChatGptCodex(repairPayload, trace, context, attempt + 1);
    const repairedById = new Map(repaired.items.map((item) => [item.id, item.translation]));
    result = {
      items: result.items.map((item) => repairedById.has(item.id)
        ? { ...item, translation: repairedById.get(item.id) }
        : item)
    };
    placeholderIntegrity = summarizePlaceholderIntegrity(payload.items, result.items);
  }
  assertPlaceholderIntegrity(placeholderIntegrity);
  await traceSpan(trace, "normalize-translation-result", {
    input: sanitize(parsed),
    metadata: { requestedItemCount: payload.items.length, ...placeholderIntegrity }
  }, async () => ({
    outputItemCount: result.items.length,
    missingItemCount: payload.items.length - result.items.length,
    placeholderIntegrity
  }));

  return result;
}

async function auditArticleWithChatGptCodex(payload, trace, _context) {
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
      reasoningEffort: CODEX_REASONING_EFFORT,
      targetLanguage: payload.targetLanguage,
      blockCount: payload.blocks.length,
      sourceUrl: payload.url
    }
  });

  let raw = "";
  let responseMeta = {};
  const modelStartedAt = Date.now();
  await logDiagnostic("model-request-start", {
    ...summarizeDiagnosticPayload(payload),
    model: CODEX_MODEL,
    reasoningEffort: CODEX_REASONING_EFFORT,
    promptChars: prompt.length
  });
  try {
    const response = await translateViaCodexChatGpt(prompt, {
      model: CODEX_MODEL,
      reasoningEffort: CODEX_REASONING_EFFORT,
      sessionId: payload.auditKey || payload.url
    });
    raw = response.outputText;
    responseMeta = {
      requestId: response.requestId,
      responseId: response.responseId,
      responseStatus: response.responseStatus,
      reasoningEffort: response.reasoningEffort,
      eventCount: response.eventCount,
      rawOutputChars: raw.length,
      ...response.timings
    };
    await logDiagnostic("model-request-complete", {
      ...summarizeDiagnosticPayload(payload),
      model: CODEX_MODEL,
      durationMs: Date.now() - modelStartedAt,
      ...responseMeta
    });
    generation.update({
      output: sanitize(raw),
      usageDetails: estimateUsage(prompt, raw),
      metadata: { status: "ok", usageEstimated: true, ...responseMeta }
    }).end();
  } catch (error) {
    await logDiagnostic("model-request-error", {
      ...summarizeDiagnosticPayload(payload),
      model: CODEX_MODEL,
      durationMs: Date.now() - modelStartedAt,
      error: String(error?.message || error)
    });
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
  }, async () => parseJsonOutput(raw));

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

function summarizePayload(payload) {
  return sanitize({
    mode: payload.mode,
    targetLanguage: payload.targetLanguage,
    url: payload.url,
    title: payload.title,
    clientRequestId: payload.clientRequestId,
    phase: payload.phase,
    batchIndex: payload.batchIndex,
    batchCount: payload.batchCount,
    sourceBlockCount: payload.sourceBlockCount,
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
    clientRequestId: payload.clientRequestId,
    phase: payload.phase || payload.summary?.phase,
    sourceBlockCount: payload.sourceBlockCount,
    blockCount: payload.blocks?.length || 0,
    auditKey: payload.auditKey || null
  });
}

export async function shutdownTranslationService() {
  await shutdownLangfuse();
}
