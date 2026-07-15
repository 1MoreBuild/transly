import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { NATIVE_HOST_NAME } from "./config.mjs";
import { extensionIdFromManifestKey } from "./extension-id.mjs";

if (process.platform !== "darwin") {
  throw new Error("The first Native Host installer currently supports macOS only.");
}

const projectRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const extensionManifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const extensionId = extensionIdFromManifestKey(extensionManifest.key);
const extensionOrigin = `chrome-extension://${extensionId}/`;
const appDir = path.join(os.homedir(), "Library", "Application Support", "Transly", "native-host");
const launcherPath = path.join(appDir, "launch.sh");
const logDir = path.join(os.homedir(), "Library", "Logs", "Transly");
const stderrLogPath = path.join(logDir, "native-host-stderr.log");
const chromeHostDir = path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
const hostManifestPath = path.join(chromeHostDir, `${NATIVE_HOST_NAME}.json`);

await mkdir(appDir, { recursive: true, mode: 0o700 });
await mkdir(chromeHostDir, { recursive: true, mode: 0o700 });
await mkdir(logDir, { recursive: true, mode: 0o700 });
await writeFile(stderrLogPath, "", { flag: "a", mode: 0o600 });
await chmod(stderrLogPath, 0o600);

const launcher = [
  "#!/bin/sh",
  `export TRANSLY_PROJECT_ROOT=${shellQuote(projectRoot)}`,
  `export TRANSLY_EXTENSION_ORIGIN=${shellQuote(extensionOrigin)}`,
  `cd ${shellQuote(projectRoot)} || exit 1`,
  `exec ${shellQuote(process.execPath)} ${shellQuote(path.join(projectRoot, "native-host", "host.mjs"))} "$@" 2>> ${shellQuote(stderrLogPath)}`,
  ""
].join("\n");
await atomicWrite(launcherPath, launcher, 0o700);

const hostManifest = {
  name: NATIVE_HOST_NAME,
  description: "Native host for Transly",
  path: launcherPath,
  type: "stdio",
  allowed_origins: [extensionOrigin]
};
await atomicWrite(hostManifestPath, `${JSON.stringify(hostManifest, null, 2)}\n`, 0o600);

process.stdout.write([
  "Native Messaging Host installed.",
  `Host: ${NATIVE_HOST_NAME}`,
  `Extension ID: ${extensionId}`,
  `Manifest: ${hostManifestPath}`,
  `Launcher: ${launcherPath}`,
  `Diagnostics: ${path.join(logDir, "native-host.jsonl")}`,
  `Errors: ${stderrLogPath}`,
  "Reload the unpacked extension in chrome://extensions after manifest changes.",
  ""
].join("\n"));

async function atomicWrite(file, content, mode) {
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode });
    await chmod(temporary, mode);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}
