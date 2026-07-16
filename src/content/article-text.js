(function initializeArticleText(global) {
  const PROTECTED_PLACEHOLDER_RE = /\[\[TRANSLY_PH_\d+]]/g;

  function extractTranslatableText(value) {
    return String(value || "")
      .replace(PROTECTED_PLACEHOLDER_RE, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  global.TranslyArticleText = Object.freeze({ extractTranslatableText });
})(globalThis);
