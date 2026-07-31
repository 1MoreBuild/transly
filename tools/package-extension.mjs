import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const distDir = path.join(projectRoot, "dist");
const stagingDir = path.join(distDir, ".extension-package");
const outputPath = path.join(distDir, `transly-${manifest.version}.zip`);
const rootFiles = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "manifest.json",
  "popup.css",
  "popup.html",
  "popup.js",
  "options.css",
  "options.html",
  "options.js"
];

await rm(stagingDir, { recursive: true, force: true });
await rm(outputPath, { force: true });
await mkdir(stagingDir, { recursive: true });

try {
  for (const relativePath of rootFiles) {
    await cp(path.join(projectRoot, relativePath), path.join(stagingDir, relativePath));
  }
  const storeManifest = { ...manifest };
  delete storeManifest.key;
  await writeFile(
    path.join(stagingDir, "manifest.json"),
    `${JSON.stringify(storeManifest, null, 2)}\n`
  );
  await cp(path.join(projectRoot, "assets", "icons"), path.join(stagingDir, "assets", "icons"), { recursive: true });
  await cp(path.join(projectRoot, "assets", "providers"), path.join(stagingDir, "assets", "providers"), { recursive: true });
  await cp(path.join(projectRoot, "src"), path.join(stagingDir, "src"), {
    recursive: true,
    filter(source) {
      return !source.endsWith(".test.mjs");
    }
  });

  const result = spawnSync("zip", ["-qr", outputPath, "."], {
    cwd: stagingDir,
    encoding: "utf8"
  });
  if (result.error?.code === "ENOENT") {
    throw new Error("The `zip` command is required to create a Chrome Web Store package.");
  }
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Extension packaging failed.");
  console.log(outputPath);
} finally {
  await rm(stagingDir, { recursive: true, force: true });
}
