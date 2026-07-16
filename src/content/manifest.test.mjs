import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../../manifest.json", import.meta.url), "utf8"));

test("article scripts run in frames without duplicating subtitle runtime", () => {
  const articleEntry = manifest.content_scripts.find((entry) => entry.js?.includes("src/content/article.js"));
  const subtitleEntry = manifest.content_scripts.find((entry) => entry.js?.includes("src/content/subtitle-content.js"));

  assert.ok(articleEntry);
  assert.equal(articleEntry.all_frames, true);
  assert.equal(articleEntry.match_about_blank, true);
  assert.equal(articleEntry.js.includes("src/content/article-audit.js"), true);
  assert.equal(articleEntry.js.includes("src/content/article-style.js"), true);
  assert.equal(articleEntry.js.includes("src/content/article-text.js"), true);
  assert.equal(articleEntry.js.includes("src/content/article-progress.js"), true);
  assert.equal(articleEntry.js.includes("src/content/article-batching.js"), true);
  assert.equal(articleEntry.js.includes("src/content/subtitle-content.js"), false);

  assert.ok(subtitleEntry);
  assert.notEqual(subtitleEntry.all_frames, true);
  assert.equal(subtitleEntry.js.includes("src/content/article.js"), false);
});
