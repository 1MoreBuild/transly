import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";
import type { CopiedPublicFile, UserManifest } from "wxt";
import { extensionManifest } from "./extension.manifest.mjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isE2EBuild = process.env.TRANSLY_E2E === "1";
const manifest = structuredClone(extensionManifest) as unknown as UserManifest;

if (isE2EBuild) {
  const e2eMatches = ["http://127.0.0.1/*"];
  for (const entry of manifest.content_scripts ?? []) {
    if (entry.js?.some((file) => file.includes("subtitle-"))) entry.matches = e2eMatches;
  }
  for (const entry of manifest.web_accessible_resources ?? []) {
    if (typeof entry === "string") continue;
    if (entry.resources.some((file) => file.includes("subtitle-") || file.includes("transly-player"))) {
      entry.matches = e2eMatches;
    }
  }
}

function collectRuntimeAssets(directory: string, destination = directory): CopiedPublicFile[] {
  const absoluteDirectory = path.join(projectRoot, directory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const source = path.join(directory, entry.name);
    const target = path.posix.join(destination.replaceAll(path.sep, "/"), entry.name);
    if (entry.isDirectory()) return collectRuntimeAssets(source, target);
    if (entry.name.endsWith(".test.mjs")) return [];
    return [{ absoluteSrc: path.join(projectRoot, source), relativeDest: target }];
  });
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifestVersion: 3,
  outDir: "dist",
  outDirTemplate: isE2EBuild ? "extension-e2e" : "extension",
  manifest,
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      files.push(
        ...collectRuntimeAssets("assets/icons"),
        ...collectRuntimeAssets("assets/providers"),
        ...collectRuntimeAssets("src/content"),
        ...collectRuntimeAssets("src/injected")
      );
    }
  }
});
