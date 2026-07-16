(function initializeArticlePlacement(global) {
  const NESTED_TEXT_BLOCK_SELECTOR = "p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption";

  function isTableCell(element) {
    return element?.tagName === "TD" || element?.tagName === "TH";
  }

  function closestTableCell(element) {
    if (isTableCell(element)) return element;
    return element?.closest?.("td,th") || null;
  }

  function containsNestedTextBlock(element) {
    return isTableCell(element) && Boolean(element.querySelector?.(NESTED_TEXT_BLOCK_SELECTOR));
  }

  function isGridItem(element) {
    if (!element?.parentElement || isTableCell(element)) return false;
    const display = global.getComputedStyle?.(element.parentElement)?.display || "";
    return display === "grid" || display === "inline-grid";
  }

  function getNestedTranslation(source, id) {
    if (!isEmbeddedContainer(source) || !id) return null;
    return [...source.children].find((child) => (
      child.classList?.contains("transly-translation") && child.dataset?.translyFor === id
    )) || null;
  }

  function getTranslationSource(translation) {
    const parent = translation?.parentElement;
    if (!isEmbeddedContainer(parent)) return null;
    return parent.dataset?.translyArticleId === translation.dataset?.translyFor ? parent : null;
  }

  function insertTranslation(source, translation) {
    const tableCell = isTableCell(source);
    const gridItem = !tableCell && isGridItem(source);
    if (!tableCell && !gridItem) return false;

    prepareSourceParts(source);
    translation.classList.add(tableCell ? "transly-translation-in-cell" : "transly-translation-in-grid-item");
    source.appendChild(translation);
    return true;
  }

  function prepareSourceParts(source) {
    source.classList.add("transly-embedded-translation-container");
    for (const child of [...source.childNodes]) {
      if (child.nodeType === 3) {
        const wrapper = source.ownerDocument.createElement("span");
        wrapper.className = "transly-embedded-source-part transly-embedded-source-text";
        child.replaceWith(wrapper);
        wrapper.appendChild(child);
        continue;
      }
      if (child.nodeType === 1 && !child.classList.contains("transly-translation")) {
        child.classList.add("transly-embedded-source-part");
      }
    }
  }

  function restoreSourceParts(source) {
    if (!isEmbeddedContainer(source)) return;
    for (const child of [...source.children]) {
      if (child.classList.contains("transly-embedded-source-text")) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      child.classList.remove("transly-embedded-source-part");
    }
    source.classList.remove("transly-embedded-translation-container");
  }

  function isEmbeddedContainer(element) {
    return Boolean(element?.classList?.contains("transly-embedded-translation-container"));
  }

  global.TranslyArticlePlacement = Object.freeze({
    closestTableCell,
    containsNestedTextBlock,
    getNestedTranslation,
    getTranslationSource,
    insertTranslation,
    isGridItem,
    isTableCell,
    restoreSourceParts
  });
})(globalThis);
