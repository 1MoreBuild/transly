import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_LOCAL_ENV = fileURLToPath(new URL("../.env.local", import.meta.url));

export function loadLocalEnv(file = DEFAULT_LOCAL_ENV) {
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
