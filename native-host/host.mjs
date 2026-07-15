import process from "node:process";
import {
  flushDiagnostics,
  logDiagnostic,
  summarizeDiagnosticPayload
} from "../bridge/diagnostics.mjs";
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
  const maxConcurrentRequests = 5;
  const pendingJobs = [];
  const activeJobs = new Set();
  const scheduledJobs = new Set();
  let writeQueue = Promise.resolve();
  let closing = false;
  let shutdownPromise = null;

  const writeResponse = (message) => {
    writeQueue = writeQueue
      .catch(() => {})
      .then(() => writeNativeMessage(process.stdout, message));
    return writeQueue;
  };

  const pumpJobs = () => {
    while (activeJobs.size < maxConcurrentRequests && pendingJobs.length) {
      const job = pendingJobs.shift();
      let task;
      task = processMessage(job.raw, handleServiceRequest, job.queuedAt)
        .catch((error) => {
          process.stderr.write(`Native request failed: ${error.message}\n`);
        })
        .finally(() => {
          activeJobs.delete(task);
          job.resolve();
          pumpJobs();
        });
      activeJobs.add(task);
    }
  };

  const scheduleMessage = (raw) => {
    let resolveJob;
    const scheduled = new Promise((resolve) => {
      resolveJob = resolve;
    });
    scheduledJobs.add(scheduled);
    scheduled.finally(() => scheduledJobs.delete(scheduled));
    pendingJobs.push({ raw, resolve: resolveJob, queuedAt: Date.now() });
    pumpJobs();
  };

  const processImmediateMessage = (raw) => {
    let task;
    task = processMessage(raw, handleServiceRequest)
      .catch((error) => {
        process.stderr.write(`Native request failed: ${error.message}\n`);
      })
      .finally(() => scheduledJobs.delete(task));
    scheduledJobs.add(task);
  };

  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    closing = true;
    shutdownPromise = Promise.allSettled([...scheduledJobs])
      .then(() => writeQueue.catch(() => {}))
      .then(() => shutdownTranslationService())
      .then(() => flushDiagnostics())
      .catch((error) => {
        process.stderr.write(`Langfuse shutdown failed: ${error.message}\n`);
      });
    return shutdownPromise;
  };

  createNativeMessageReader(process.stdin, {
    onMessage(message) {
      if (closing) return;
      if (message?.type === "health") processImmediateMessage(message);
      else scheduleMessage(message);
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

  async function processMessage(raw, handler, queuedAt = Date.now()) {
    let id = typeof raw?.id === "string" ? raw.id : "unknown";
    let requestType = typeof raw?.type === "string" ? raw.type : "unknown";
    let requestSummary = {};
    let progressQueue = Promise.resolve();
    let progressItemCount = 0;
    const startedAt = Date.now();
    const queueWaitMs = Math.max(0, startedAt - queuedAt);
    try {
      const request = validateNativeRequest(raw);
      id = request.id;
      requestType = request.type;
      requestSummary = summarizeDiagnosticPayload(request.payload || {});
      await logDiagnostic("native-request-start", {
        nativeRequestId: id,
        requestType,
        queueWaitMs,
        ...requestSummary
      });
      const data = await handler(request.type, request.payload || {}, {
        onProgress(data) {
          if (closing) return;
          progressItemCount += Array.isArray(data?.items) ? data.items.length : 0;
          progressQueue = progressQueue
            .catch(() => {})
            .then(() => writeResponse({
              protocolVersion: NATIVE_PROTOCOL_VERSION,
              id,
              ok: true,
              progress: true,
              data
            }))
            .catch((error) => {
              process.stderr.write(`Native progress write failed: ${error.message}\n`);
            });
        }
      });
      await progressQueue;
      await logDiagnostic("native-request-complete", {
        nativeRequestId: id,
        requestType,
        queueWaitMs,
        ...requestSummary,
        durationMs: Date.now() - startedAt,
        progressItemCount,
        resultItemCount: Array.isArray(data?.items) ? data.items.length : 0,
        resultActionCount: Array.isArray(data?.actions) ? data.actions.length : 0
      });
      if (!closing) {
        await writeResponse({
          protocolVersion: NATIVE_PROTOCOL_VERSION,
          id,
          ok: true,
          data
        });
      }
    } catch (error) {
      await progressQueue.catch(() => {});
      await logDiagnostic("native-request-error", {
        nativeRequestId: id,
        requestType,
        queueWaitMs,
        ...requestSummary,
        durationMs: Date.now() - startedAt,
        error: String(error?.message || error),
        errorCode: error?.code || null
      });
      if (!closing) {
        await writeResponse({
          protocolVersion: NATIVE_PROTOCOL_VERSION,
          id,
          ok: false,
          error: serializeError(error)
        });
      }
    }
  }
}
