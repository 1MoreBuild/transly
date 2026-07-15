import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { NATIVE_HOST_NAME, NATIVE_PROTOCOL_VERSION } from "./config.mjs";
import { extensionIdFromManifestKey } from "./extension-id.mjs";
import { createNativeMessageReader, encodeNativeMessage } from "./protocol.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const extensionManifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const extensionId = extensionIdFromManifestKey(extensionManifest.key);
const origin = `chrome-extension://${extensionId}/`;
const hostManifestPath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "NativeMessagingHosts",
  `${NATIVE_HOST_NAME}.json`
);
const hostManifest = JSON.parse(await readFile(hostManifestPath, "utf8"));
const requests = [
  {
    id: "concurrent-smoke-1",
    text: "The first translation request should stream while another request is active."
  },
  {
    id: "concurrent-smoke-2",
    text: "The second translation request verifies the native host concurrency scheduler."
  }
];

const result = await runConcurrentSmoke(hostManifest.path, origin, requests);
for (const request of requests) {
  const response = result.responses.get(request.id);
  const translation = response?.data?.items?.[0]?.translation || "";
  if (!response?.ok || !/[\u3400-\u9fff]/u.test(translation)) {
    throw new Error(`${request.id} did not return a Chinese translation.`);
  }
  if (!result.progressIds.has(request.id)) {
    throw new Error(`${request.id} completed without a streaming progress item.`);
  }
}

process.stdout.write(
  `Concurrent Native translation OK (${extensionId}): ${result.progressIds.size} progress streams, ${result.responses.size} responses\n`
);

function runConcurrentSmoke(launcher, callerOrigin, requestSpecs) {
  return new Promise((resolve, reject) => {
    const child = spawn(launcher, [callerOrigin], { stdio: ["pipe", "pipe", "pipe"] });
    const responses = new Map();
    const progressIds = new Set();
    let stderr = "";
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin.end();
      if (error) {
        child.kill();
        reject(error);
      } else {
        resolve({ responses, progressIds });
      }
    };
    const timeout = setTimeout(() => {
      finish(new Error(`Concurrent Native Host smoke test timed out. ${stderr.trim()}`));
    }, 210_000);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    createNativeMessageReader(child.stdout, {
      onMessage(message) {
        if (message?.progress) {
          if (Array.isArray(message.data?.items) && message.data.items.length) progressIds.add(message.id);
          return;
        }
        responses.set(message.id, message);
        if (responses.size === requestSpecs.length) finish();
      },
      onError(error) { finish(error); }
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      if (!settled) finish(new Error(`Native Host exited before both responses (${signal || code}). ${stderr.trim()}`));
    });

    for (const request of requestSpecs) {
      child.stdin.write(encodeNativeMessage({
        protocolVersion: NATIVE_PROTOCOL_VERSION,
        id: request.id,
        type: "translate",
        payload: {
          mode: "article",
          phase: "translate",
          clientRequestId: "concurrent-smoke",
          batchIndex: request.id.endsWith("1") ? 1 : 2,
          batchCount: 2,
          sourceBlockCount: 2,
          targetLanguage: "zh-CN",
          url: "https://example.com/transly-concurrent-smoke-test",
          title: "Concurrent Native Messaging smoke test",
          context: "Both batches belong to one short article and share this complete context.",
          cacheKey: request.id,
          items: [{ id: `${request.id}-item`, text: request.text }]
        }
      }, 2_000_000));
    }
  });
}
