import assert from "node:assert/strict";
import test from "node:test";
import { resolveCodexUrl } from "./codex-chatgpt.mjs";

test("Codex backend URL is pinned to the ChatGPT Codex endpoint", () => {
  const expected = "https://chatgpt.com/backend-api/codex/responses";
  assert.equal(resolveCodexUrl(), expected);
  assert.equal(resolveCodexUrl("https://chatgpt.com/backend-api"), expected);
  assert.equal(resolveCodexUrl(expected), expected);
});

test("Codex backend URL rejects OAuth exfiltration surfaces", () => {
  for (const url of [
    "https://example.com/backend-api",
    "http://chatgpt.com/backend-api",
    "https://chatgpt.com:8443/backend-api",
    "https://chatgpt.com/backend-api-evil",
    "https://chatgpt.com/backend-api?redirect=https://example.com",
    "https://user:password@chatgpt.com/backend-api"
  ]) {
    assert.throws(() => resolveCodexUrl(url));
  }
});
