import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./article-text.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { extractTranslatableText } = context.TranslyArticleText;

test("protected-only code and formula blocks have no translatable text", () => {
  assert.equal(extractTranslatableText("[[TRANSLY_PH_0]]"), "");
  assert.equal(extractTranslatableText("  [[TRANSLY_PH_12]] \n [[TRANSLY_PH_13]]  "), "");
});

test("prose around protected nodes remains translatable", () => {
  assert.equal(
    extractTranslatableText("Use [[TRANSLY_PH_0]] in this request."),
    "Use in this request."
  );
});

test("link text remains while link boundary placeholders are removed", () => {
  assert.equal(
    extractTranslatableText("Read [[TRANSLY_PH_0]] the documentation [[TRANSLY_PH_1]] first."),
    "Read the documentation first."
  );
});
