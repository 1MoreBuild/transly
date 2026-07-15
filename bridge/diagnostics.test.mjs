import assert from "node:assert/strict";
import test from "node:test";
import { isSensitiveDiagnosticKey, summarizeDiagnosticPayload } from "./diagnostics.mjs";

test("diagnostic payload summaries exclude source text and URL query data", () => {
  const summary = summarizeDiagnosticPayload({
    clientRequestId: "run-123",
    mode: "article",
    phase: "translate",
    targetLanguage: "zh-CN",
    batchIndex: 1,
    batchCount: 2,
    sourceBlockCount: 3,
    url: "https://example.com/article?private=1#section",
    items: [
      { id: "one", text: "secret article text" },
      { id: "two", text: "more text" }
    ]
  });

  assert.deepEqual(summary, {
    clientRequestId: "run-123",
    mode: "article",
    phase: "translate",
    targetLanguage: "zh-CN",
    batchIndex: 1,
    batchCount: 2,
    sourceBlockCount: 3,
    itemCount: 2,
    blockCount: 0,
    totalTextChars: 28,
    url: "https://example.com/article"
  });
  assert.equal(JSON.stringify(summary).includes("secret article text"), false);
  assert.equal(JSON.stringify(summary).includes("private=1"), false);
});

test("diagnostic redaction keeps quality counters but rejects credential fields", () => {
  assert.equal(isSensitiveDiagnosticKey("missingTokenCount"), false);
  assert.equal(isSensitiveDiagnosticKey("inputTokens"), false);
  assert.equal(isSensitiveDiagnosticKey("access_token"), true);
  assert.equal(isSensitiveDiagnosticKey("refreshToken"), true);
  assert.equal(isSensitiveDiagnosticKey("LANGFUSE_SECRET_KEY"), true);
  assert.equal(isSensitiveDiagnosticKey("authorization"), true);
});
