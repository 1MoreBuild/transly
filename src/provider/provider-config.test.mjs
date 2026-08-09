import assert from "node:assert/strict";
import test from "node:test";
import { providerSummary, validateProviderConfig } from "./provider-config.js";

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
