import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const failures = [];
const majorNodeVersion = Number(process.versions.node.split(".")[0]);

check(process.platform === "darwin", "Transly currently supports macOS only.");
check(majorNodeVersion >= 20, `Node.js 20 or newer is required; found ${process.version}.`);

const chromePaths = [
  "/Applications/Google Chrome.app",
  path.join(os.homedir(), "Applications", "Google Chrome.app")
];
check(await anyAccessible(chromePaths), "Google Chrome is not installed in a standard Applications directory.");

const codex = spawnSync("codex", ["login", "status"], {
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1" }
});
if (codex.error) {
  failures.push("Codex CLI is not available on PATH. Install Codex CLI, then run `codex login`.");
} else {
  const loginOutput = `${codex.stdout || ""}\n${codex.stderr || ""}`;
  check(codex.status === 0 && /Logged in using ChatGPT/i.test(loginOutput), "Codex CLI is not logged in with ChatGPT. Run `codex login`.");
}

try {
  const configuredCodexHome = process.env.CODEX_HOME
    ? process.env.CODEX_HOME.replace(/^~(?=$|\/)/, os.homedir())
    : path.join(os.homedir(), ".codex");
  const authPath = path.join(path.resolve(configuredCodexHome), "auth.json");
  const auth = JSON.parse(await readFile(authPath, "utf8"));
  check(
    typeof auth?.tokens?.access_token === "string" && typeof auth?.tokens?.refresh_token === "string",
    "Codex auth does not contain ChatGPT OAuth tokens. Run `codex login`."
  );
} catch (error) {
  failures.push(`Cannot read Codex ChatGPT auth: ${error.message}`);
}

if (failures.length) {
  failures.forEach((message) => process.stderr.write(`FAIL  ${message}\n`));
  process.exit(1);
}

process.stdout.write("OK  macOS, Node.js, Google Chrome, and Codex ChatGPT login are ready.\n");

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function anyAccessible(files) {
  for (const file of files) {
    try {
      await access(file);
      return true;
    } catch {}
  }
  return false;
}
