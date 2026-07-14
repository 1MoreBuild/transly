import process from "node:process";
import { NATIVE_PROTOCOL_VERSION } from "./config.mjs";
import {
  createNativeMessageReader,
  serializeError,
  validateNativeRequest,
  writeNativeMessage
} from "./protocol.mjs";

const callerOrigin = process.argv[2] || "";
const expectedOrigin = process.env.TRANSLY_EXTENSION_ORIGIN || "";

if (!expectedOrigin || callerOrigin !== expectedOrigin) {
  process.stderr.write(`Native host rejected caller origin: ${callerOrigin || "<missing>"}\n`);
  process.exitCode = 1;
} else {
  await runHost();
}

async function runHost() {
  const { handleServiceRequest, shutdownTranslationService } = await import("../bridge/server.mjs");
  let queue = Promise.resolve();
  let closing = false;
  let shutdownPromise = null;

  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    shutdownPromise = queue
      .catch((error) => {
        process.stderr.write(`Native request failed during shutdown: ${error.message}\n`);
      })
      .then(() => shutdownTranslationService())
      .catch((error) => {
        process.stderr.write(`Langfuse shutdown failed: ${error.message}\n`);
      });
    return shutdownPromise;
  };

  createNativeMessageReader(process.stdin, {
    onMessage(message) {
      if (closing) return;
      queue = queue
        .then(() => processMessage(message, handleServiceRequest))
        .catch((error) => {
          process.stderr.write(`Native request queue failed: ${error.message}\n`);
        });
    },
    onError(error) {
      process.stderr.write(`${error.code || "NATIVE_PROTOCOL_ERROR"}: ${error.message}\n`);
      process.stdin.destroy();
      void shutdown();
    },
    onEnd() {
      void shutdown();
    }
  });

  process.once("SIGTERM", () => {
    process.stdin.destroy();
    void shutdown();
  });
  process.stdin.resume();

  async function processMessage(raw, handler) {
    let id = typeof raw?.id === "string" ? raw.id : "unknown";
    try {
      const request = validateNativeRequest(raw);
      id = request.id;
      const data = await handler(request.type, request.payload || {});
      if (!closing) {
        await writeNativeMessage(process.stdout, {
          protocolVersion: NATIVE_PROTOCOL_VERSION,
          id,
          ok: true,
          data
        });
      }
    } catch (error) {
      if (!closing) {
        await writeNativeMessage(process.stdout, {
          protocolVersion: NATIVE_PROTOCOL_VERSION,
          id,
          ok: false,
          error: serializeError(error)
        });
      }
    }
  }
}
