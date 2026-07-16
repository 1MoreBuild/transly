import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const articleSource = await readFile(new URL("./article.js", import.meta.url), "utf8");
const contentStyles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

test("article translation does not inject page-level toast UI", () => {
  assert.equal(articleSource.includes("showToast("), false);
  assert.equal(articleSource.includes("transly-toast"), false);
  assert.equal(contentStyles.includes(".transly-toast"), false);
});
