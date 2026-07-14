import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { NATIVE_PROTOCOL_VERSION } from "./config.mjs";
import {
  createNativeMessageReader,
  encodeNativeMessage,
  validateNativeRequest
} from "./protocol.mjs";

test("native protocol reads multiple framed messages", async () => {
  const stream = new PassThrough();
  const messages = [];
  const ended = new Promise((resolve, reject) => {
    createNativeMessageReader(stream, {
      onMessage: (message) => messages.push(message),
      onError: reject,
      onEnd: resolve
    });
  });
  stream.end(Buffer.concat([
    encodeNativeMessage({ id: "one" }, 2_000_000),
    encodeNativeMessage({ id: "two", text: "中文" }, 2_000_000)
  ]));
  await ended;
  assert.deepEqual(messages, [{ id: "one" }, { id: "two", text: "中文" }]);
});

test("native request validation rejects unknown request types", () => {
  assert.throws(() => validateNativeRequest({
    protocolVersion: NATIVE_PROTOCOL_VERSION,
    id: "request-1",
    type: "unknown",
    payload: {}
  }), { code: "UNSUPPORTED_REQUEST" });
});
