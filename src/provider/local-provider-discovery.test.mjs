import assert from "node:assert/strict";
import test from "node:test";
import { discoverLocalProviders } from "./local-provider-discovery.js";

test("local discovery returns compatible services and key requirements", async () => {
  const candidates = [
    { apiUrl: "http://127.0.0.1:1001/v1", hint: "Ready" },
    { apiUrl: "http://127.0.0.1:1002/v1", hint: "Protected" },
    { apiUrl: "http://127.0.0.1:1003/v1", hint: "Missing" }
  ];
  const fetchImpl = async (url, options) => {
    assert.equal(options.headers.accept, "application/json");
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.cache, "no-store");
    if (url.includes("1001")) {
      return response(200, { data: [{ id: "model-a" }, { id: "model-b" }] });
    }
    if (url.includes("1002")) return response(401);
    throw new Error("connection refused");
  };

  assert.deepEqual(await discoverLocalProviders({ candidates, fetchImpl, timeoutMs: 50 }), [
    {
      apiUrl: "http://127.0.0.1:1001/v1",
      hint: "Ready",
      authRequired: false,
      models: ["model-a", "model-b"]
    },
    {
      apiUrl: "http://127.0.0.1:1002/v1",
      hint: "Protected",
      authRequired: true,
      models: []
    }
  ]);
});

function response(status, body = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    }
  };
}
