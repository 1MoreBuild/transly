import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extensionManifest, YOUTUBE_MATCHES } from "../../extension.manifest.mjs";

const packageMetadata = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const manifest = { ...extensionManifest, version: packageMetadata.version };

test("package and extension versions stay aligned", () => {
  assert.equal(manifest.version, packageMetadata.version);
});

test("article runtime covers all pages while subtitle runtime is limited to YouTube", () => {
  const articleEntry = manifest.content_scripts.find((entry) => entry.js?.includes("src/content/article.js"));
  const subtitleEntry = manifest.content_scripts.find((entry) => entry.js?.includes("src/content/subtitle-content.js"));
  const subtitleBootstrap = manifest.content_scripts.find((entry) => entry.js?.includes("src/content/subtitle-bootstrap.js"));

  assert.ok(articleEntry);
  assert.deepEqual(articleEntry.matches, ["<all_urls>"]);
  assert.equal(articleEntry.all_frames, true);
  assert.equal(articleEntry.match_about_blank, true);
  assert.equal(articleEntry.js.includes("src/content/article-audit.js"), true);
  assert.equal(articleEntry.js.includes("src/content/article-style.js"), true);
  assert.equal(articleEntry.js.includes("src/content/article-text.js"), true);
  assert.equal(articleEntry.js.includes("src/content/article-progress.js"), true);
  assert.equal(articleEntry.js.includes("src/content/article-batching.js"), true);
  assert.equal(articleEntry.js.includes("src/content/subtitle-content.js"), false);

  assert.ok(subtitleEntry);
  assert.deepEqual(subtitleEntry.matches, YOUTUBE_MATCHES);
  assert.equal(subtitleEntry.matches.some((match) => match.includes("twitter.com") || match.includes("x.com")), false);
  assert.equal(subtitleEntry.all_frames, true);
  assert.equal(subtitleEntry.match_about_blank, true);
  assert.equal(subtitleEntry.js.includes("src/content/subtitle-core.js"), true);
  assert.equal(subtitleEntry.js.includes("src/content/article.js"), false);

  assert.ok(subtitleBootstrap);
  assert.deepEqual(subtitleBootstrap.matches, YOUTUBE_MATCHES);
  assert.equal(subtitleBootstrap.run_at, "document_start");
  assert.equal(subtitleBootstrap.all_frames, true);

  const subtitleResources = manifest.web_accessible_resources.find((entry) => (
    entry.resources?.includes("src/injected/subtitle-hook.js")
  ));
  assert.ok(subtitleResources);
  assert.deepEqual(subtitleResources.matches, YOUTUBE_MATCHES);
});
