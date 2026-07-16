import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./article-audit.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { isAuditCandidateContaminated } = context.TranslyArticleAudit;

test("rejects a nested emphasis node inside an already translated source block", () => {
  const element = fakeElement({ insideTranslatedSource: true });
  assert.equal(isAuditCandidateContaminated(element), true);
});

test("rejects a list container that contains translated list items", () => {
  const element = fakeElement({ containsTranslatedContent: true });
  assert.equal(isAuditCandidateContaminated(element), true);
});

test("keeps an untranslated leaf and the translated source block itself auditable", () => {
  assert.equal(isAuditCandidateContaminated(fakeElement()), false);
  assert.equal(isAuditCandidateContaminated(fakeElement({ isTranslatedSource: true })), false);
});

function fakeElement(options = {}) {
  return {
    dataset: options.isTranslatedSource ? { translyTranslated: "true" } : {},
    parentElement: {
      closest() {
        return options.insideTranslatedSource ? {} : null;
      }
    },
    querySelector() {
      return options.containsTranslatedContent ? {} : null;
    }
  };
}
