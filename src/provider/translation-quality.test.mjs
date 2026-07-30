import assert from "node:assert/strict";
import test from "node:test";
import { assertPlaceholderIntegrity, summarizePlaceholderIntegrity } from "./translation-quality.js";

test("placeholder integrity reports missing and duplicated tokens", () => {
  const summary = summarizePlaceholderIntegrity([
    { id: "a", text: "One [[TRANSLY_PH_0]] two" },
    { id: "b", text: "Three [[TRANSLY_PH_1]]" }
  ], [
    { id: "a", translation: "一 二" },
    { id: "b", translation: "三 [[TRANSLY_PH_1]] [[TRANSLY_PH_1]]" }
  ]);
  assert.equal(summary.missingTokenCount, 1);
  assert.equal(summary.extraTokenCount, 1);
  assert.deepEqual(summary.affectedItemIds, ["a", "b"]);
  assert.throws(() => assertPlaceholderIntegrity(summary), /placeholder mismatch/);
});

test("placeholder integrity accepts exact preservation", () => {
  const summary = summarizePlaceholderIntegrity(
    [{ id: "a", text: "One [[TRANSLY_PH_0]]" }],
    [{ id: "a", translation: "一 [[TRANSLY_PH_0]]" }]
  );
  assert.doesNotThrow(() => assertPlaceholderIntegrity(summary));
});
