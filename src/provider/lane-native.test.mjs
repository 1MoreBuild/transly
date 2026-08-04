import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { extensionManifest } from "../../extension.manifest.mjs";
import {
  connectLane,
  LANE_NATIVE_HOST_NAME,
  LANE_NATIVE_PROTOCOL_VERSION,
  normalizeLaneConnection
} from "./lane-native.js";

const EXPECTED_TRANSLY_EXTENSION_ID = "mdjfkiddlpdgchddcckhcmdjekmmhcgp";

test("the WXT manifest metadata matches the Chrome Web Store extension id", async () => {
  const digest = createHash("sha256")
    .update(Buffer.from(extensionManifest.key, "base64"))
    .digest()
    .subarray(0, 16);
  const extensionId = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/[0-9a-f]/g, (character) =>
      String.fromCharCode("a".charCodeAt(0) + Number.parseInt(character, 16))
    );
  assert.equal(extensionId, EXPECTED_TRANSLY_EXTENSION_ID);
  assert.ok(extensionManifest.permissions.includes("nativeMessaging"));
});

test("Lane Native Messaging returns a ready provider configuration", async () => {
  let host;
  let request;
  const chrome = {
    runtime: {
      lastError: null,
      sendNativeMessage(hostName, payload, callback) {
        host = hostName;
        request = payload;
        callback({
          protocolVersion: 1,
          ok: true,
          data: {
            service: "lane",
            apiUrl: "http://127.0.0.1:3210/v1",
            apiKey: "lane-client-key",
            models: ["provider/model-a", "provider/model-b"],
            defaultModel: "provider/model-b",
            protocol: "responses"
          }
        });
      }
    }
  };
  assert.deepEqual(await connectLane(chrome), {
    config: {
      apiUrl: "http://127.0.0.1:3210/v1",
      apiKey: "lane-client-key",
      model: "provider/model-b",
      protocol: "responses"
    },
    models: ["provider/model-a", "provider/model-b"]
  });
  assert.equal(host, LANE_NATIVE_HOST_NAME);
  assert.deepEqual(request, {
    protocolVersion: LANE_NATIVE_PROTOCOL_VERSION,
    type: "connect"
  });
});

test("Lane connection rejects remote endpoints and missing models", () => {
  assert.throws(() => normalizeLaneConnection({
    apiUrl: "https://example.com/v1",
    apiKey: "key",
    models: ["model"]
  }), { code: "LANE_NOT_READY" });
  assert.throws(() => normalizeLaneConnection({
    apiUrl: "http://127.0.0.1:3210/v1",
    apiKey: "key",
    models: []
  }), { code: "LANE_NOT_READY" });
});

test("Lane Native Messaging reports a missing desktop app without leaking runtime details", async () => {
  const chrome = {
    runtime: {
      lastError: null,
      sendNativeMessage(_host, _payload, callback) {
        this.lastError = { message: "Specified native messaging host not found." };
        callback(undefined);
        this.lastError = null;
      }
    }
  };
  await assert.rejects(connectLane(chrome), {
    code: "LANE_NOT_AVAILABLE",
    message: "Lane is not installed or its Chrome integration is not ready."
  });
});
