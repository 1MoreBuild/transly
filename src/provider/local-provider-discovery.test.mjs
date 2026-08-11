import assert from "node:assert/strict";
import test from "node:test";
import { discoverLocalProviders } from "./local-provider-discovery.js";

test("local provider probes never forward stored credentials", async () => {
  let requestOptions;
  const results = await discoverLocalProviders({
    candidates: [{ apiUrl: "http://127.0.0.1:4321/v1", hint: "Local test" }],
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "local-model" }] })
      };
    }
  });

  assert.equal(requestOptions.headers.authorization, undefined);
  assert.equal(requestOptions.headers.accept, "application/json");
  assert.equal(requestOptions.cache, "no-store");
  assert.deepEqual(results[0]?.models, ["local-model"]);
});
