(function initializeArticleAudit(global) {
  const TRANSLATED_SOURCE_SELECTOR = "[data-transly-translated='true']";
  const RENDERED_TRANSLATION_SELECTOR = ".transly-translation";

  function isAuditCandidateContaminated(element) {
    if (!element) return false;
    const insideTranslatedSource = Boolean(
      element.parentElement?.closest?.(TRANSLATED_SOURCE_SELECTOR)
    );
    const containsTranslatedContent = Boolean(
      element.querySelector?.(`${TRANSLATED_SOURCE_SELECTOR}, ${RENDERED_TRANSLATION_SELECTOR}`)
    );
    return insideTranslatedSource || containsTranslatedContent;
  }

  global.TranslyArticleAudit = Object.freeze({ isAuditCandidateContaminated });
})(globalThis);
