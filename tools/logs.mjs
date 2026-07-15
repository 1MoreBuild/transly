import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const limitIndex = args.indexOf("--limit");
const requestedLimit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : 80;
const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, requestedLimit)) : 80;
const logDir = path.join(os.homedir(), "Library", "Logs", "Transly");
const diagnosticPath = path.join(logDir, "native-host.jsonl");
const stderrPath = path.join(logDir, "native-host-stderr.log");

await printTail("Diagnostic events", diagnosticPath, limit);
await printTail("Native Host stderr", stderrPath, Math.min(limit, 40));

async function printTail(label, filePath, lineLimit) {
  process.stdout.write(`\n${label}: ${filePath}\n`);
  const content = await readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const lines = content.trim().split("\n").filter(Boolean).slice(-lineLimit);
  if (!lines.length) {
    process.stdout.write("(no entries)\n");
    return;
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}
