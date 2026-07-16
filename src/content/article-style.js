(function initializeArticleStyle(global) {
  function resolveTranslationFontWeight(style) {
    const variationWeight = parseFontVariationWeight(style?.fontVariationSettings);
    if (variationWeight !== null) return String(variationWeight);
    return String(style?.fontWeight || "");
  }

  function parseFontVariationWeight(settings) {
    const value = String(settings || "");
    if (!value || value === "normal") return null;
    const match = value.match(/(?:["']?wght["']?)\s+(-?\d+(?:\.\d+)?)/i);
    if (!match) return null;
    const weight = Number(match[1]);
    if (!Number.isFinite(weight) || weight < 1 || weight > 1000) return null;
    return Math.round(weight);
  }

  global.TranslyArticleStyle = Object.freeze({
    parseFontVariationWeight,
    resolveTranslationFontWeight
  });
})(globalThis);
