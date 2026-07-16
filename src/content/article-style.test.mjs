import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./article-style.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { parseFontVariationWeight, resolveTranslationFontWeight } = context.TranslyArticleStyle;

test("uses the variable font weight axis instead of the font face registration weight", () => {
  const weight = resolveTranslationFontWeight({
    fontWeight: "900",
    fontVariationSettings: '"wght" 420, "opsz" 12'
  });

  assert.equal(weight, "420");
});

test("falls back to the computed font weight for non-variable fonts", () => {
  assert.equal(resolveTranslationFontWeight({ fontWeight: "600", fontVariationSettings: "normal" }), "600");
});

test("ignores missing and invalid variable weight axes", () => {
  assert.equal(parseFontVariationWeight('"opsz" 12'), null);
  assert.equal(parseFontVariationWeight('"wght" 1200'), null);
  assert.equal(resolveTranslationFontWeight({ fontWeight: "400", fontVariationSettings: '"wght" nope' }), "400");
});
