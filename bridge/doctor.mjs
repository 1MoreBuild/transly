import { spawnSync } from "node:child_process";

const codex = spawnSync("codex", ["doctor"], {
  encoding: "utf8",
  env: { ...process.env, NO_COLOR: "1", TERM: "xterm-256color" }
});

if (codex.error) {
  process.stderr.write(`Failed to run Codex CLI: ${codex.error.message}\n`);
  process.exit(1);
}
process.stdout.write(codex.stdout || "");
process.stderr.write(codex.stderr || "");
process.exit(codex.status ?? 1);
