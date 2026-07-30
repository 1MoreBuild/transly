import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { extractModelIds, listProviderModels, requestModel, resolveProviderEndpoint, testProvider } from "./openai-compatible.js";

test("provider endpoint expands base URLs and preserves complete endpoints", () => {
  assert.deepEqual(resolveProviderEndpoint({
    apiUrl: "http://127.0.0.1:8787",
    protocol: "auto"
  }), {
    endpoint: "http://127.0.0.1:8787/v1/responses",
    modelsUrl: "http://127.0.0.1:8787/v1/models",
    protocol: "responses"
  });
  assert.deepEqual(resolveProviderEndpoint({
    apiUrl: "https://api.example.com/v1/chat/completions",
    protocol: "auto"
  }), {
    endpoint: "https://api.example.com/v1/chat/completions",
    modelsUrl: "https://api.example.com/v1/models",
    protocol: "chat-completions"
  });
});

test("explicit protocol converts a complete endpoint", () => {
  assert.equal(resolveProviderEndpoint({
    apiUrl: "https://api.example.com/v1/responses",
    protocol: "chat-completions"
  }).endpoint, "https://api.example.com/v1/chat/completions");
});

test("Responses API streams text with bearer authentication", async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received = { url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"type":"response.output_text.delta","delta":"[\\"你"}\n\n');
    response.end('data: {"type":"response.output_text.delta","delta":"好\\"]"}\n\ndata: [DONE]\n\n');
  });
  await listen(server);
  t.after(() => server.close());
  const deltas = [];
  const result = await requestModel({
    apiUrl: `${serverUrl(server)}/v1`,
    apiKey: "secret-key",
    model: "model-a",
    protocol: "responses"
  }, {
    instructions: "Translate.",
    prompt: "Hello"
  }, { onTextDelta: (delta) => deltas.push(delta) });

  assert.equal(result.outputText, '["你好"]');
  assert.deepEqual(deltas, ['["你', '好"]']);
  assert.equal(received.url, "/v1/responses");
  assert.equal(received.authorization, "Bearer secret-key");
  assert.equal(received.body.model, "model-a");
  assert.equal(received.body.stream, true);
  assert.equal(received.body.store, false);
});

test("Responses API detects an SSE body with a mislabeled JSON content type", async (t) => {
  let authorization;
  const server = createServer((_request, response) => {
    authorization = _request.headers.authorization;
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.write("event: response.created\n");
    response.write('data: {"type":"response.created"}\n\n');
    response.end('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"[\\"兼容\\"]"}\n\n');
  });
  await listen(server);
  t.after(() => server.close());

  const result = await requestModel({
    apiUrl: `${serverUrl(server)}/v1`,
    apiKey: "",
    model: "model-a",
    protocol: "responses"
  }, {
    instructions: "Translate.",
    prompt: "Compatible"
  });

  assert.equal(result.outputText, '["兼容"]');
  assert.equal(authorization, undefined);
});

test("Responses API still accepts a complete non-stream JSON response", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: '["完整"]' }]
      }]
    }));
  });
  await listen(server);
  t.after(() => server.close());

  const result = await requestModel({
    apiUrl: `${serverUrl(server)}/v1`,
    apiKey: "secret-key",
    model: "model-a",
    protocol: "responses"
  }, {
    instructions: "Translate.",
    prompt: "Complete"
  });

  assert.equal(result.outputText, '["完整"]');
});

test("provider connection check reads the compatible model list", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"data":[{"id":"model-a"}]}');
  });
  await listen(server);
  t.after(() => server.close());
  const result = await testProvider({
    apiUrl: `${serverUrl(server)}/v1`,
    apiKey: "secret-key",
    model: "model-a",
    protocol: "auto"
  });
  assert.deepEqual(result, { ok: true, modelAvailable: true, modelCount: 1, models: ["model-a"] });
});

test("model discovery returns unique ids from common compatible shapes", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"models":[{"name":"model-b"},{"id":"model-a"},{"id":"model-a"}]}');
  });
  await listen(server);
  t.after(() => server.close());

  const result = await listProviderModels({
    apiUrl: `${serverUrl(server)}/v1`,
    apiKey: "",
    protocol: "auto"
  });
  assert.deepEqual(result, { ok: true, modelCount: 2, models: ["model-b", "model-a"] });
  assert.deepEqual(extractModelIds({ data: ["model-c", { id: "model-d" }] }), ["model-c", "model-d"]);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function serverUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}
