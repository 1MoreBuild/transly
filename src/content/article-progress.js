(function initializeArticleProgress(global) {
  const PLACEHOLDER_RE = /\[\[TRANSLY_PH_\d+]]/g;

  function selectRenderableProgressItems(sourceItems, progressItems) {
    const sourceById = new Map((sourceItems || []).map((item) => [item?.id, item]));
    const emittedIds = new Set();
    const renderable = [];

    for (const progressItem of progressItems || []) {
      const id = progressItem?.id;
      const source = sourceById.get(id);
      const translation = typeof progressItem?.translation === "string"
        ? progressItem.translation.trim()
        : "";
      if (!source || !translation || emittedIds.has(id)) continue;
      if (!hasExactPlaceholders(source.text, translation)) continue;
      emittedIds.add(id);
      renderable.push({ id, translation });
    }

    return renderable;
  }

  function hasExactPlaceholders(source, translation) {
    const expected = collectPlaceholders(source);
    const actual = collectPlaceholders(translation);
    if (expected.length !== actual.length) return false;
    return expected.every((token, index) => token === actual[index]);
  }

  function collectPlaceholders(value) {
    return [...String(value || "").matchAll(PLACEHOLDER_RE)]
      .map((match) => match[0])
      .sort();
  }

  global.TranslyArticleProgress = Object.freeze({ selectRenderableProgressItems });
})(globalThis);
