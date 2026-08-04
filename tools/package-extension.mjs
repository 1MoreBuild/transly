import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const buildDir = path.join(projectRoot, "dist", "extension");
const distDir = path.join(projectRoot, "dist");
const stagingDir = path.join(distDir, ".extension-package");
const outputPath = path.join(distDir, `transly-${packageMetadata.version}.zip`);

await rm(stagingDir, { recursive: true, force: true });
await rm(outputPath, { force: true });
await mkdir(stagingDir, { recursive: true });

try {
  await cp(buildDir, stagingDir, { recursive: true });
  await cp(path.join(projectRoot, "LICENSE"), path.join(stagingDir, "LICENSE"));
  await cp(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), path.join(stagingDir, "THIRD_PARTY_NOTICES.md"));
  const manifest = JSON.parse(await readFile(path.join(stagingDir, "manifest.json"), "utf8"));
  const storeManifest = { ...manifest };
  delete storeManifest.key;
  await writeFile(
    path.join(stagingDir, "manifest.json"),
    `${JSON.stringify(storeManifest, null, 2)}\n`
  );
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
