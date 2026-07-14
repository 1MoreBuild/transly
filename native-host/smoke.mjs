import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { NATIVE_HOST_NAME } from "./config.mjs";
import { extensionIdFromManifestKey } from "./extension-id.mjs";
import { requestNativeHost } from "./probe.mjs";

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
const result = await requestNativeHost(hostManifest.path, origin, "translate", {
  mode: "article",
  targetLanguage: "zh-CN",
  url: "https://example.com/native-messaging-smoke-test",
  title: "Native Messaging smoke test",
  context: "This request verifies the complete local translation path.",
  items: [{
    id: "smoke-1",
    text: "The translation bridge is connected securely through Chrome Native Messaging."
  }]
}, {
  requestId: "smoke-translate",
  timeoutMs: 120_000
});

if (!result?.ok) {
  throw new Error(`${result?.error?.code || "NATIVE_SMOKE_FAILED"}: ${result?.error?.message || "Unknown error"}`);
}

const translation = result.data?.items?.find((item) => item.id === "smoke-1")?.translation || "";
if (!translation || !/[\u3400-\u9fff]/u.test(translation)) {
  throw new Error(`Expected a Chinese translation, received: ${translation || "<empty>"}`);
}

process.stdout.write(`Native translation OK (${extensionId}): ${translation}\n`);
