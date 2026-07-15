import assert from "node:assert/strict";
import test from "node:test";
import { assertPlaceholderIntegrity, summarizePlaceholderIntegrity } from "./translation-quality.mjs";

test("placeholder integrity reports missing and duplicated tokens without text content", () => {
  const summary = summarizePlaceholderIntegrity([
    { id: "one", text: "Before [[TRANSLY_PH_0]] after" },
    { id: "two", text: "[[TRANSLY_PH_0]] value [[TRANSLY_PH_1]]" }
  ], [
    { id: "one", translation: "之前之后" },
    { id: "two", translation: "[[TRANSLY_PH_0]] 值 [[TRANSLY_PH_1]] [[TRANSLY_PH_1]]" }
  ]);

  assert.deepEqual(summary, {
    expectedTokenCount: 3,
    actualTokenCount: 3,
    missingTokenCount: 1,
    extraTokenCount: 1,
    affectedItemCount: 2,
    affectedItemIds: ["one", "two"]
  });
  assert.throws(() => assertPlaceholderIntegrity(summary), {
    code: "TRANSLATION_PLACEHOLDER_MISMATCH"
  });
});

test("placeholder integrity accepts exact token preservation", () => {
  const summary = summarizePlaceholderIntegrity(
    [{ id: "one", text: "Before [[TRANSLY_PH_0]] after" }],
    [{ id: "one", translation: "之前 [[TRANSLY_PH_0]] 之后" }]
  );
  assert.doesNotThrow(() => assertPlaceholderIntegrity(summary));
});
