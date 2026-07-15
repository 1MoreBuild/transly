let sdk = null;
let enabled = false;
let propagateAttributesFn = null;
let setActiveTraceIOFn = null;
let startActiveObservationFn = null;

export async function initLangfuse() {
  enabled = Boolean(
    process.env.LANGFUSE_PUBLIC_KEY
    && process.env.LANGFUSE_SECRET_KEY
    && (process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST)
  );

  if (!enabled) {
    console.warn("Langfuse tracing disabled: missing LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, or LANGFUSE_BASE_URL.");
    return { enabled: false };
  }

  try {
    const [{ NodeSDK }, { LangfuseSpanProcessor }, tracing] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@langfuse/otel"),
      import("@langfuse/tracing")
    ]);

    propagateAttributesFn = tracing.propagateAttributes;
    setActiveTraceIOFn = tracing.setActiveTraceIO;
    startActiveObservationFn = tracing.startActiveObservation;

    sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()]
    });
    sdk.start();
    return { enabled: true };
  } catch (error) {
    enabled = false;
    console.warn(`Langfuse tracing disabled: ${String(error?.message || error)}`);
    return { enabled: false, error: String(error?.message || error) };
  }
}

export async function shutdownLangfuse() {
  if (sdk) await sdk.shutdown();
}

export async function withTranslateTrace(payload, fn) {
  if (!enabled) return fn(noopObservation());

  const input = safeTraceInput(payload);
  return startActiveObservationFn("translate-request", async (span) => {
    span.update({
      input,
      metadata: {
        mode: payload.mode,
        phase: payload.phase,
        clientRequestId: payload.clientRequestId,
        batchIndex: payload.batchIndex,
        batchCount: payload.batchCount,
        sourceBlockCount: payload.sourceBlockCount,
        targetLanguage: payload.targetLanguage,
        itemCount: payload.items?.length || 0,
        sourceUrl: payload.url,
        provider: "codex-chatgpt-responses"
      },
      tags: [
        "translate",
        payload.mode || "unknown",
        payload.phase,
        "codex-chatgpt-responses"
      ].filter(Boolean)
    });

    setActiveTraceIOFn({ input });

    return propagateAttributesFn(
      {
        sessionId: payload.clientRequestId
          ? `translation-run:${payload.clientRequestId}`
          : stableSessionId(payload.url),
        metadata: propagationMetadata(payload),
        traceName: `translate-${payload.mode || "request"}`
      },
      async () => {
        try {
          const result = await fn(span);
          const output = {
            itemCount: result.items?.length || 0,
            ids: result.items?.map((item) => item.id) || [],
            actionCount: result.actions?.length || 0,
            actionTypes: result.actions?.map((action) => action.type) || []
          };
          span.update({ output });
          setActiveTraceIOFn({ input, output });
          return result;
        } catch (error) {
          span.update({
            level: "ERROR",
            output: { error: String(error?.message || error) }
          });
          throw error;
        }
      }
    );
  });
}

export async function traceSpan(parent, name, params, fn) {
  if (!enabled || !parent?.startObservation) return fn(noopObservation());

  const span = parent.startObservation(name, sanitize(params));
  try {
    const result = await fn(span);
    span.update({ output: sanitize(result) }).end();
    return result;
  } catch (error) {
    span.update({
      level: "ERROR",
      output: { error: String(error?.message || error) }
    }).end();
    throw error;
  }
}

export function startGeneration(parent, params) {
  if (!enabled || !parent?.startObservation) return noopObservation();
  return parent.startObservation(
    "codex-translate-generation",
    sanitize(params),
    { asType: "generation" }
  );
}

export function estimateUsage(prompt, output) {
  const input = estimateTokens(prompt);
  const out = estimateTokens(output);
  return {
    input,
    output: out,
    total: input + out
  };
}

export function sanitize(value) {
  return redactSecrets(value);
}

function safeTraceInput(payload) {
  return sanitize({
    mode: payload.mode,
    phase: payload.phase,
    clientRequestId: payload.clientRequestId,
    batchIndex: payload.batchIndex,
    batchCount: payload.batchCount,
    sourceBlockCount: payload.sourceBlockCount,
    targetLanguage: payload.targetLanguage,
    url: payload.url,
    title: payload.title,
    context: payload.context,
    items: payload.items
  });
}

function redactSecrets(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    let output = value;
    for (const secret of [
      process.env.LANGFUSE_SECRET_KEY,
      process.env.LANGFUSE_PUBLIC_KEY,
      process.env.LANGFUSE_BASE_URL,
      process.env.LANGFUSE_HOST
    ]) {
      if (secret) output = output.split(secret).join("[REDACTED]");
    }
    return output;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (/secret|token|password|key/i.test(key)) return [key, "[REDACTED]"];
      return [key, redactSecrets(item)];
    }));
  }
  return value;
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function stableSessionId(url) {
  try {
    const parsed = new URL(url);
    return `page:${parsed.origin}${parsed.pathname}`;
  } catch {
    return "page:unknown";
  }
}

function propagationMetadata(payload) {
  const values = {
    app: "transly",
    provider: "codex-chatgpt-responses",
    clientRequestId: payload.clientRequestId,
    phase: payload.phase,
    batchIndex: payload.batchIndex,
    batchCount: payload.batchCount,
    sourceBlockCount: payload.sourceBlockCount
  };
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value != null && value !== "")
      .map(([key, value]) => [key, String(value)])
  );
}

function noopObservation() {
  return {
    update() { return this; },
    end() { return this; },
    startObservation() { return noopObservation(); }
  };
}
