import assert from "node:assert/strict";
import test from "node:test";
import { providerSummary, validateProviderConfig, validateProviderConnection } from "./provider-config.js";

test("provider config accepts HTTPS and localhost HTTP", () => {
  assert.equal(validateProviderConfig({
    apiUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "model-a",
    protocol: "auto"
  }).apiUrl, "https://api.example.com/v1");
  assert.equal(validateProviderConfig({
    apiUrl: "http://127.0.0.1:8787/v1",
    apiKey: "local",
    model: "model-a"
  }).protocol, "auto");
});

test("provider config rejects remote cleartext HTTP and allows an empty API key", () => {
  assert.throws(() => validateProviderConfig({
    apiUrl: "http://api.example.com/v1",
    apiKey: "secret",
    model: "model-a"
  }), /HTTPS/);
  assert.equal(validateProviderConfig({
    apiUrl: "https://api.example.com/v1",
    model: "model-a"
  }).apiKey, "");
});

test("provider connection validation allows model discovery before model selection", () => {
  assert.equal(validateProviderConnection({
    apiUrl: "https://api.example.com/v1",
    apiKey: "secret"
  }).model, "");
});

test("provider summary never returns the API key", () => {
  const summary = providerSummary({
    apiUrl: "https://api.example.com/v1",
    apiKey: "do-not-return",
    model: "model-a"
  });
  assert.deepEqual(summary, {
    configured: true,
    host: "api.example.com",
    model: "model-a",
    provider: {
      id: "custom",
      name: "AI provider",
      icon: ""
    },
    protocol: "auto"
  });
  assert.equal(JSON.stringify(summary).includes("do-not-return"), false);
});

test("provider summary identifies OpenAI models", () => {
  const summary = providerSummary({
    apiUrl: "http://127.0.0.1:3210/v1",
    apiKey: "secret",
    model: "openai-codex/gpt-5.6-sol",
    protocol: "responses"
  });
  assert.deepEqual(summary.provider, {
    id: "openai",
    name: "OpenAI",
    icon: "assets/providers/openai.svg"
  });
});

test("provider summary treats a keyless loopback service as configured", () => {
  assert.equal(providerSummary({
    apiUrl: "http://127.0.0.1:8787/v1",
    model: "provider-model"
  }).configured, true);
});
