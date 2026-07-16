import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./article-batching.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { planArticleBatches, prioritizeArticleItems } = context.TranslyArticleBatching;

test("article batching keeps short articles in one request", () => {
  const items = makeItems(12, 300);
  const batches = planArticleBatches(items, { maxChars: 28000, maxItems: 28 });
  assert.equal(batches.length, 1);
  assert.deepEqual([...batches[0].items].map((item) => item.id), items.map((item) => item.id));
});

test("article batching splits 52 ordered items into two balanced requests", () => {
  const items = makeItems(52, 280);
  const batches = planArticleBatches(items, { maxChars: 28000, maxItems: 28 });
  assert.equal(batches.length, 2);
  assert.ok(Math.abs(batches[0].items.length - batches[1].items.length) <= 1);
  assert.deepEqual(
    [...batches[0].items, ...batches[1].items].map((item) => item.id),
    items.map((item) => item.id)
  );
});

test("article batching grows with text size without a fixed request cap", () => {
  const items = makeItems(120, 800);
  const batches = planArticleBatches(items, { maxChars: 12000, maxItems: 28 });
  assert.ok(batches.length > 5);
  assert.equal(batches.flatMap((batch) => [...batch.items]).length, items.length);
});

test("visible navigation items stream before visible article items", () => {
  const items = [
    makePositionedItem("article-1", 100, 180),
    makePositionedItem("navigation-1", 40, 80, "navigation-inline"),
    makePositionedItem("article-2", 900, 980),
    makePositionedItem("navigation-2", 500, 560, "navigation-block")
  ];

  const prioritized = prioritizeArticleItems(items, { scrollY: 0, viewportHeight: 700 });
  assert.deepEqual(
    [...prioritized].map((item) => item.id),
    ["navigation-1", "navigation-2", "article-1", "article-2"]
  );
});

function makeItems(count, textLength) {
  return Array.from({ length: count }, (_, index) => ({
    id: `article-${index + 1}`,
    text: "x".repeat(textLength)
  }));
}

function makePositionedItem(id, top, bottom, presentation) {
  return {
    id,
    text: id,
    presentation,
    element: {
      getBoundingClientRect() {
        return { top, bottom };
      }
    }
  };
}
