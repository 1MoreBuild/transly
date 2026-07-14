import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NATIVE_HOST_NAME } from "./config.mjs";

if (process.platform !== "darwin") {
  throw new Error("The first Native Host uninstaller currently supports macOS only.");
}

const chromeHostDir = path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
const hostManifestPath = path.join(chromeHostDir, `${NATIVE_HOST_NAME}.json`);
const appDir = path.join(os.homedir(), "Library", "Application Support", "Transly", "native-host");

await rm(hostManifestPath, { force: true });
await rm(appDir, { recursive: true, force: true });
process.stdout.write(`Removed Native Messaging Host ${NATIVE_HOST_NAME}.\n`);
