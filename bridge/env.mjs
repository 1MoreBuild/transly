import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export function loadLocalEnv(file = path.resolve(process.cwd(), ".env.local")) {
  if (!existsSync(file)) return;

  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = unquote(rawValue.trim());
  }

  if (process.env.LANGFUSE_BASE_URL && !process.env.LANGFUSE_HOST) {
    process.env.LANGFUSE_HOST = process.env.LANGFUSE_BASE_URL;
  }
}

function unquote(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
