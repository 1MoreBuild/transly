import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { NATIVE_HOST_NAME } from "./config.mjs";
import { extensionIdFromManifestKey } from "./extension-id.mjs";
import { requestNativeHost } from "./probe.mjs";

const checks = [];
const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const extensionManifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const extensionId = extensionIdFromManifestKey(extensionManifest.key);
const extensionOrigin = `chrome-extension://${extensionId}/`;
const expectedLauncherPath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Transly",
  "native-host",
  "launch.sh"
);
const hostManifestPath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "NativeMessagingHosts",
  `${NATIVE_HOST_NAME}.json`
);

let hostManifest;
try {
  hostManifest = JSON.parse(await readFile(hostManifestPath, "utf8"));
  pass("host manifest", hostManifestPath);
} catch (error) {
  fail("host manifest", error.message);
}

if (hostManifest) {
  if (hostManifest.name === NATIVE_HOST_NAME) pass("host name", hostManifest.name);
  else fail("host name", String(hostManifest.name || "missing"));

  if (hostManifest.allowed_origins?.length === 1 && hostManifest.allowed_origins[0] === extensionOrigin) {
    pass("allowed origin", extensionOrigin);
  } else {
    fail("allowed origin", JSON.stringify(hostManifest.allowed_origins || []));
  }

  if (hostManifest.path !== expectedLauncherPath) {
    fail("launcher path", String(hostManifest.path || "missing"));
  } else {
    try {
      await access(hostManifest.path, constants.X_OK);
      pass("launcher", hostManifest.path);
    } catch (error) {
      fail("launcher", error.message);
    }
  }

  if (!checks.some((item) => !item.ok)) {
    try {
      const health = await requestNativeHost(hostManifest.path, extensionOrigin, "health", {}, {
        requestId: "doctor-health",
        timeoutMs: 15_000
      });
      if (health?.ok && health?.data?.credentials?.available) {
        pass("native round trip", `${health.data.model}; Langfuse ${health.data.langfuse ? "enabled" : "disabled"}`);
      } else {
        fail("native round trip", JSON.stringify(health));
      }
    } catch (error) {
      fail("native round trip", error.message);
    }
  }
}

for (const item of checks) {
  process.stdout.write(`${item.ok ? "OK" : "FAIL"}  ${item.name}: ${item.detail}\n`);
}
process.stdout.write(`Extension ID: ${extensionId}\n`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;

function pass(name, detail) { checks.push({ ok: true, name, detail }); }
function fail(name, detail) { checks.push({ ok: false, name, detail }); }
