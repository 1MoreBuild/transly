import os from "node:os";
import {
  MAX_NATIVE_REQUEST_BYTES,
  MAX_NATIVE_RESPONSE_BYTES,
  NATIVE_PROTOCOL_VERSION
} from "./config.mjs";

const LITTLE_ENDIAN = os.endianness() === "LE";
const REQUEST_TYPES = new Set(["health", "translate", "audit"]);

export function encodeNativeMessage(message, maxBytes = MAX_NATIVE_RESPONSE_BYTES) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (!payload.length || payload.length > maxBytes) {
    throw protocolError("MESSAGE_TOO_LARGE", `Native message is ${payload.length} bytes; limit is ${maxBytes}.`);
  }
  const header = Buffer.allocUnsafe(4);
  if (LITTLE_ENDIAN) header.writeUInt32LE(payload.length, 0);
  else header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function createNativeMessageReader(stream, handlers = {}) {
  let buffer = Buffer.alloc(0);
  let stopped = false;

  const fail = (error) => {
    if (stopped) return;
    stopped = true;
    handlers.onError?.(error);
  };

  stream.on("data", (chunk) => {
    if (stopped) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

    while (buffer.length >= 4) {
      const size = LITTLE_ENDIAN ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
      if (!size || size > MAX_NATIVE_REQUEST_BYTES) {
        fail(protocolError("MESSAGE_TOO_LARGE", `Native request declares ${size} bytes.`));
        return;
      }
      if (buffer.length < size + 4) return;

      const payload = buffer.subarray(4, size + 4);
      buffer = buffer.subarray(size + 4);
      try {
        handlers.onMessage?.(JSON.parse(payload.toString("utf8")));
      } catch (error) {
        fail(protocolError("INVALID_JSON", `Native request is not valid JSON: ${error.message}`));
        return;
      }
    }
  });

  stream.on("end", () => {
    if (buffer.length && !stopped) {
      fail(protocolError("TRUNCATED_MESSAGE", "Native request ended before the declared frame was complete."));
      return;
    }
    handlers.onEnd?.();
  });
  stream.on("error", fail);

  return { stop() { stopped = true; } };
}

export async function writeNativeMessage(stream, message) {
  const frame = encodeNativeMessage(message);
  if (stream.write(frame)) return;
  await new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

export function validateNativeRequest(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw protocolError("INVALID_REQUEST", "Native request must be an object.");
  }
  if (message.protocolVersion !== NATIVE_PROTOCOL_VERSION) {
    throw protocolError("UNSUPPORTED_PROTOCOL", `Expected protocolVersion ${NATIVE_PROTOCOL_VERSION}.`);
  }
  if (typeof message.id !== "string" || !message.id || message.id.length > 128) {
    throw protocolError("INVALID_REQUEST_ID", "Native request id must be a non-empty string up to 128 characters.");
  }
  if (!REQUEST_TYPES.has(message.type)) {
    throw protocolError("UNSUPPORTED_REQUEST", `Unsupported native request type: ${String(message.type || "")}`);
  }
  if (message.type !== "health" && (!message.payload || typeof message.payload !== "object" || Array.isArray(message.payload))) {
    throw protocolError("INVALID_PAYLOAD", "Native request payload must be an object.");
  }
  return message;
}

export function protocolError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = Boolean(options.retryable);
  return error;
}

export function serializeError(error) {
  return {
    code: String(error?.code || "NATIVE_HOST_ERROR"),
    message: String(error?.message || error || "Native host failed."),
    retryable: Boolean(error?.retryable)
  };
}
