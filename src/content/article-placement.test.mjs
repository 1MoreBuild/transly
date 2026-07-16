import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./article-placement.js", import.meta.url), "utf8");
const context = vm.createContext({
  getComputedStyle(element) {
    return { display: element.computedDisplay || "block" };
  }
});
vm.runInContext(source, context);
const placement = context.TranslyArticlePlacement;

test("prefers nested text blocks over translating their table cell parent", () => {
  const cell = new FakeElement("td");
  const paragraph = new FakeElement("p");
  cell.appendChild(paragraph);
  cell.nestedTextBlock = paragraph;

  assert.equal(placement.closestTableCell(paragraph), cell);
  assert.equal(placement.containsNestedTextBlock(cell), true);
});

test("keeps a direct table-cell translation inside its cell", () => {
  const fixture = createPlacementFixture("td");

  assert.equal(placement.insertTranslation(fixture.sourceElement, fixture.translation), true);
  assertEmbeddedPlacement(fixture.sourceElement, fixture.translation, "transly-translation-in-cell");
  assert.equal(placement.getNestedTranslation(fixture.sourceElement, "article-1"), fixture.translation);
  assert.equal(placement.getTranslationSource(fixture.translation), fixture.sourceElement);

  fixture.translation.remove();
  placement.restoreSourceParts(fixture.sourceElement);
  assertRestoredPlacement(fixture);
});

test("keeps a translated grid item in its original grid column", () => {
  const document = new FakeDocument();
  const grid = document.createElement("div");
  grid.computedDisplay = "grid";
  const fixture = createPlacementFixture("p", document);
  grid.appendChild(fixture.sourceElement);

  assert.equal(placement.isGridItem(fixture.sourceElement), true);
  assert.equal(placement.insertTranslation(fixture.sourceElement, fixture.translation), true);
  assertEmbeddedPlacement(fixture.sourceElement, fixture.translation, "transly-translation-in-grid-item");
  assert.equal(grid.children.length, 1);

  fixture.translation.remove();
  placement.restoreSourceParts(fixture.sourceElement);
  assertRestoredPlacement(fixture);
});

test("leaves normal article blocks on the sibling insertion path", () => {
  assert.equal(placement.insertTranslation(new FakeElement("p"), new FakeElement("span")), false);
});

function createPlacementFixture(tagName, document = new FakeDocument()) {
  const sourceElement = document.createElement(tagName);
  sourceElement.dataset.translyArticleId = "article-1";
  const text = document.createTextNode("Summary");
  const emphasis = document.createElement("b");
  const translation = document.createElement("span");
  translation.classList.add("transly-translation");
  translation.dataset.translyFor = "article-1";
  sourceElement.appendChild(text);
  sourceElement.appendChild(emphasis);
  return { sourceElement, translation, text, emphasis };
}

function assertEmbeddedPlacement(sourceElement, translation, translationClass) {
  assert.equal(translation.parentElement, sourceElement);
  assert.equal(sourceElement.childNodes.at(-1), translation);
  assert.equal(sourceElement.classList.contains("transly-embedded-translation-container"), true);
  assert.equal(translation.classList.contains(translationClass), true);
}

function assertRestoredPlacement(fixture) {
  assert.equal(fixture.sourceElement.childNodes[0], fixture.text);
  assert.equal(fixture.emphasis.classList.contains("transly-embedded-source-part"), false);
  assert.equal(fixture.sourceElement.classList.contains("transly-embedded-translation-container"), false);
}

class FakeDocument {
  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  createTextNode(value) {
    const node = new FakeText(value);
    node.ownerDocument = this;
    return node;
  }
}

class FakeNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.parentElement = null;
    this.ownerDocument = null;
  }

  replaceWith(...nodes) {
    const parent = this.parentElement;
    const index = parent?.childNodes.indexOf(this) ?? -1;
    if (index < 0) return;
    parent.childNodes.splice(index, 1, ...nodes);
    this.parentElement = null;
    for (const node of nodes) node.parentElement = parent;
  }

  remove() {
    const parent = this.parentElement;
    const index = parent?.childNodes.indexOf(this) ?? -1;
    if (index >= 0) parent.childNodes.splice(index, 1);
    this.parentElement = null;
  }
}

class FakeText extends FakeNode {
  constructor(value) {
    super(3);
    this.value = value;
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super(1);
    this.tagName = tagName.toUpperCase();
    this.childNodes = [];
    this.dataset = {};
    this.classList = new FakeClassList();
    this.nestedTextBlock = null;
    this.computedDisplay = "block";
  }

  set className(value) {
    this.classList = new FakeClassList(String(value).split(/\s+/).filter(Boolean));
  }

  get children() {
    return this.childNodes.filter((child) => child.nodeType === 1);
  }

  appendChild(child) {
    child.remove?.();
    this.childNodes.push(child);
    child.parentElement = this;
    child.ownerDocument ||= this.ownerDocument;
    return child;
  }

  closest(selector) {
    if (selector !== "td,th") return null;
    for (let node = this; node; node = node.parentElement) {
      if (node.tagName === "TD" || node.tagName === "TH") return node;
    }
    return null;
  }

  querySelector() {
    return this.nestedTextBlock;
  }
}

class FakeClassList {
  constructor(values = []) {
    this.values = new Set(values);
  }

  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}
