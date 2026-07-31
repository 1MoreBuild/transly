(function initializeArticleSpacing(global) {
  const DATA_VALUE = "translyOriginalMarginBottomStyle";
  const DATA_PRIORITY = "translyOriginalMarginBottomPriority";
  const DATA_PIXELS = "translyOriginalMarginBottomPx";

  function group(source, translation, computedStyle) {
    if (!source || !translation || !computedStyle) return;
    restore(source);

    const sourceMarginBottom = Math.max(0, parseFloat(computedStyle.marginBottom) || 0);
    const sourceFontSize = Math.max(1, parseFloat(computedStyle.fontSize) || 16);
    const originalValue = source.style.getPropertyValue("margin-bottom");
    const originalPriority = source.style.getPropertyPriority("margin-bottom");

    source.dataset[DATA_VALUE] = originalValue;
    source.dataset[DATA_PRIORITY] = originalPriority;
    source.dataset[DATA_PIXELS] = String(sourceMarginBottom);
    source.style.setProperty("margin-bottom", "0px", "important");

    const withinGroupGap = roundPixels(Math.min(10, Math.max(5, sourceFontSize * 0.24)));
    const afterGroupGap = sourceMarginBottom
      || roundPixels(Math.min(20, Math.max(10, sourceFontSize * 0.62)));
    translation.style.marginTop = `${withinGroupGap}px`;
    translation.style.marginBottom = `${afterGroupGap}px`;
  }

  function restore(source) {
    if (!source?.dataset || source.dataset[DATA_PIXELS] === undefined) return;
    const value = source.dataset[DATA_VALUE] || "";
    const priority = source.dataset[DATA_PRIORITY] || "";
    if (value) source.style.setProperty("margin-bottom", value, priority);
    else source.style.removeProperty("margin-bottom");
    delete source.dataset[DATA_VALUE];
    delete source.dataset[DATA_PRIORITY];
    delete source.dataset[DATA_PIXELS];
  }

  function roundPixels(value) {
    return Math.round(value * 100) / 100;
  }

  global.TranslyArticleSpacing = Object.freeze({ group, restore });
})(globalThis);
