import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const sourceCode = await readFile(new URL("./article-spacing.js", import.meta.url), "utf8");

test("translation spacing groups a translation with its source paragraph", () => {
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(sourceCode, context);

  const styleValues = new Map([["margin-bottom", "24px"]]);
  const stylePriorities = new Map([["margin-bottom", ""]]);
  const source = {
    dataset: {},
    style: {
      getPropertyValue(name) {
        return styleValues.get(name) || "";
      },
      getPropertyPriority(name) {
        return stylePriorities.get(name) || "";
      },
      setProperty(name, value, priority = "") {
        styleValues.set(name, value);
        stylePriorities.set(name, priority);
      },
      removeProperty(name) {
        styleValues.delete(name);
        stylePriorities.delete(name);
      }
    }
  };
  const translation = { style: {} };

  context.TranslyArticleSpacing.group(source, translation, {
    marginBottom: "24px",
    fontSize: "20px"
  });

  assert.equal(styleValues.get("margin-bottom"), "0px");
  assert.equal(stylePriorities.get("margin-bottom"), "important");
  assert.equal(translation.style.marginTop, "5px");
  assert.equal(translation.style.marginBottom, "24px");

  context.TranslyArticleSpacing.restore(source);
  assert.equal(styleValues.get("margin-bottom"), "24px");
  assert.equal(stylePriorities.get("margin-bottom"), "");
  assert.deepEqual(source.dataset, {});
});

test("translation spacing gives zero-margin layouts a larger after-group gap", () => {
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(sourceCode, context);
  const source = createSource();
  const translation = { style: {} };

  context.TranslyArticleSpacing.group(source, translation, {
    marginBottom: "0px",
    fontSize: "30px"
  });

  assert.equal(translation.style.marginTop, "7.2px");
  assert.equal(translation.style.marginBottom, "18.6px");
});

function createSource() {
  const values = new Map();
  return {
    dataset: {},
    style: {
      getPropertyValue(name) {
        return values.get(name) || "";
      },
      getPropertyPriority() {
        return "";
      },
      setProperty(name, value) {
        values.set(name, value);
      },
      removeProperty(name) {
        values.delete(name);
      }
    }
  };
}
