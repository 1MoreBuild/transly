const ARTICLE_BATCH_CHARS = 28000;
const ARTICLE_CONTEXT_CHARS = 36000;
const ARTICLE_MAX_ITEMS = 220;
const ARTICLE_MIN_TEXT_CHARS = 24;
const ARTICLE_FALLBACK_MAX_TEXT_CHARS = 2500;
const ARTICLE_AUDIT_MAX_BLOCKS = 60;
const ARTICLE_AUDIT_MAX_REPAIR_ITEMS = 20;
const ARTICLE_AUDIT_SAMPLE_CHARS = 520;
const ARTICLE_BLOCK_SELECTOR = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "li", "blockquote", "figcaption",
  "td", "th",
  ".article-title", ".article-subtitle", ".article__title", ".articleTitle",
  ".headline", ".summary",
  ".markdown-body > p", ".markdown-body > ul > li", ".markdown-body > ol > li",
  ".prose > p", ".prose li"
].join(",");
const ARTICLE_AUDIT_BLOCK_SELECTOR = [
  ARTICLE_BLOCK_SELECTOR,
  "[role='heading']",
  "[data-testid*='title' i]",
  "[data-testid*='subtitle' i]",
  ".reader2-post-title",
  ".post-title",
  ".subtitle",
  ".tweet-link-top",
  ".expanded-link"
].join(",");
const ARTICLE_FALLBACK_BLOCK_SELECTOR = [
  "article", "main", "section", "div",
  "[role='article']", "[data-testid*='article' i]", "[data-testid*='post' i]",
  "[class*='paragraph' i]", "[class*='content' i]", "[class*='body' i]",
  "[class*='markdown' i]", "[class*='prose' i]"
].join(",");
const ARTICLE_EXCLUDE_SELECTORS = [
  "script", "style", "noscript", "template",
  "textarea", "input", "select", "option",
  "svg", "canvas", "math", "pre", "code", "kbd",
  "nav", "footer", "aside", "form", "button",
  "[role='button']", "[role='navigation']", "[role='menu']", "[role='tablist']",
  "[hidden]", "[inert]", "[aria-hidden='true']", "[aria-hidden=true]",
  "[contenteditable=true]", "[translate=no]", ".notranslate",
  ".sr-only", ".visually-hidden", ".screen-reader-text", ".u-hiddenVisually",
  "[class*='sr-only' i]", "[class*='visually-hidden' i]", "[class*='screen-reader' i]",
  ".material-icons", "[class*='material-symbols']",
  ".transly-translation", ".transly-toast"
];
const ARTICLE_AUDIT_EXCLUDE_SELECTORS = [
  "script", "style", "noscript", "template",
  "textarea", "input", "select", "option",
  "svg", "canvas", "math", "pre", "code", "kbd",
  "nav", "footer", "aside", "form", "button",
  "[role='button']", "[role='navigation']", "[role='menu']", "[role='tablist']",
  "[hidden]", "[inert]", "[aria-hidden='true']", "[aria-hidden=true]",
  "[contenteditable=true]",
  ".sr-only", ".visually-hidden", ".screen-reader-text", ".u-hiddenVisually",
  "[class*='sr-only' i]", "[class*='visually-hidden' i]", "[class*='screen-reader' i]",
  ".material-icons", "[class*='material-symbols']",
  ".transly-translation", ".transly-toast"
];
const ARTICLE_PROTECTED_INLINE_SELECTOR = [
  "a[href]",
  "code", "kbd", "samp", "var",
  "math", "svg", "canvas", "img",
  "sub", "sup",
  "[data-transly-stay-original]",
  "[translate=no]", ".notranslate"
].join(",");
const ARTICLE_PLACEHOLDER_PREFIX = "[[TRANSLY_PH_";
const ARTICLE_PLACEHOLDER_RE = /\[\[TRANSLY_PH_(\d+)]]/g;
const ARTICLE_GENERIC_CONTAINER_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".article",
  ".post",
  ".entry-content",
  ".post-content",
  ".article-content",
  ".content",
  ".markdown-body",
  ".prose"
];
const ARTICLE_GENERIC_RULE = {
  name: "generic",
  containerSelectors: ARTICLE_GENERIC_CONTAINER_SELECTORS,
  selectors: [],
  excludeSelectors: [],
  minTextChars: ARTICLE_MIN_TEXT_CHARS,
  minWords: 3,
  fallbackMaxTextChars: ARTICLE_FALLBACK_MAX_TEXT_CHARS
};
const ARTICLE_CONTAINER_HINTS = [
  "article",
  "main",
  "[role='main']",
  "[role='article']",
  ".article",
  ".post",
  ".entry-content",
  ".post-content",
  ".article-content",
  ".available-content",
  ".body.markup",
  ".markdown-body",
  ".prose",
  "[class*='article' i]",
  "[class*='post-content' i]",
  "[class*='entry-content' i]",
  "[class*='available-content' i]",
  "[class*='markdown' i]",
  "[class*='prose' i]"
];

let articleRunId = 0;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TRANSLY_TRANSLATE_ARTICLE") {
    translateArticle(message.targetLanguage || "zh-CN")
      .then((summary) => sendResponse({ ok: true, data: summary }))
      .catch((error) => {
        console.error("[transly] article translation failed", error);
        showToast(String(error?.message || error), { tone: "error", timeout: 6000 });
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
    return true;
  }

  if (message?.type === "TRANSLY_CLEAR_ARTICLE") {
    clearArticleTranslations();
    sendResponse({ ok: true });
    return true;
  }
});

async function translateArticle(targetLanguage) {
  const runId = ++articleRunId;
  clearArticleTranslations({ cancelActiveRun: false, quiet: true });

  const rule = getArticleRule();
  if (rule.disabled) {
    throw new Error("This page is excluded by the article rule.");
  }
  const container = findArticleContainer(rule);
  const segments = collectArticleSegments(container, rule).slice(0, ARTICLE_MAX_ITEMS);
  if (!segments.length) {
    const settings = await getSettings();
    const recovered = await runArticleAuditRepair({
      runId,
      phase: "initial",
      targetLanguage,
      root: document.body,
      rule,
      translatedSegments: [],
      settings,
      context: buildFallbackArticleContext(document.body)
    });
    if (recovered.repairedCount) {
      showToast(`Article translation recovered by AI audit: ${recovered.repairedCount} blocks.`, {
        timeout: 3500
      });
      return {
        translatedCount: recovered.repairedCount,
        segmentCount: recovered.repairedCount,
        batchCount: recovered.batchCount,
        audit: recovered
      };
    }
    throw new Error(`No article text found. AI audit checked ${recovered.blockCount || 0} candidate blocks and selected no repairable article text.`);
  }

  const settings = await getSettings();
  const batchChars = Number(settings.articleBatchChars || ARTICLE_BATCH_CHARS);
  const context = buildArticleContext(segments, Number(settings.articleContextChars || ARTICLE_CONTEXT_CHARS));
  const batches = chunkItems(segments, batchChars);
  let translatedCount = 0;

  showToast(`Translating ${segments.length} article blocks in ${batches.length} batches...`);

  for (let index = 0; index < batches.length; index++) {
    if (runId !== articleRunId) return { cancelled: true };

    const batch = batches[index];
    markBatch(batch, "working");
    showToast(`Article batch ${index + 1}/${batches.length}...`);

    try {
      const cacheKey = await sha256([
        "article",
        location.href,
        targetLanguage,
        batch.map((item) => `${item.id}:${item.text}`).join("\n")
      ].join("\n"));
      const response = await requestTranslation({
        mode: "article",
        targetLanguage,
        url: location.href,
        title: document.title,
        context,
        cacheKey,
        items: batch.map(({ id, text }) => ({ id, text }))
      });
      translatedCount += renderArticleTranslations(batch, response.items || [], targetLanguage);
      markBatch(batch, "done");
    } catch (error) {
      markBatch(batch, "idle");
      throw error;
    }

    await sleep(Number(settings.minDelayMs || 500));
  }

  let audit = { enabled: Boolean(settings.enableArticleAuditLoop !== false), repairedCount: 0, actionCount: 0 };
  try {
    audit = await runArticleAuditRepair({
      runId,
      phase: "post-translate",
      targetLanguage,
      root: document.body,
      rule,
      translatedSegments: segments,
      settings,
      context
    });
  } catch (error) {
    console.warn("[transly] article audit failed", error);
    showToast(`AI audit failed: ${String(error?.message || error)}`, { tone: "error", timeout: 4000 });
    audit = {
      enabled: true,
      failed: true,
      repairedCount: 0,
      actionCount: 0,
      error: String(error?.message || error)
    };
  }
  translatedCount += audit.repairedCount;

  showToast(`Article translation complete: ${translatedCount}/${segments.length + audit.repairedCount} blocks.`, {
    timeout: 3500
  });
  return { translatedCount, segmentCount: segments.length, batchCount: batches.length, audit };
}

function getArticleRule() {
  return {
    ...ARTICLE_GENERIC_RULE,
    name: "ai-first",
    containerSelectors: uniqueStrings([...ARTICLE_CONTAINER_HINTS, ...ARTICLE_GENERIC_CONTAINER_SELECTORS]),
    selectors: [],
    excludeSelectors: uniqueStrings([...(ARTICLE_GENERIC_RULE.excludeSelectors || [])])
  };
}

function findArticleContainer(rule) {
  if (rule.bodyHeuristic === false) return document.body;
  const preferred = (rule.containerSelectors || ARTICLE_GENERIC_CONTAINER_SELECTORS)
    .flatMap((selector) => safeQueryAll(document, selector));

  const candidates = uniqueElements([...preferred, ...document.querySelectorAll("section, div")])
    .filter((element) => element !== document.body && isUsableContainer(element, rule))
    .map((element) => ({ element, score: scoreContainer(element) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.element || document.querySelector("article") || document.querySelector("main") || document.body;
}

function isUsableContainer(element, rule) {
  if (!isVisible(element) || isExcludedElement(element, rule)) return false;
  const text = compactText(element.innerText || element.textContent);
  return text.length >= 300;
}

function scoreContainer(element) {
  const text = compactText(element.innerText || element.textContent);
  const textLength = text.length;
  const paragraphCount = element.querySelectorAll("p,li,blockquote").length;
  const headingCount = element.querySelectorAll("h1,h2,h3").length;
  const linkText = [...element.querySelectorAll("a")]
    .map((link) => compactText(link.innerText || link.textContent))
    .join("");
  const linkDensity = textLength ? linkText.length / textLength : 1;
  const rect = element.getBoundingClientRect();
  const semanticBonus = /^(ARTICLE|MAIN)$/.test(element.tagName) || element.getAttribute("role") === "main" ? 900 : 0;
  const contentClassBonus = /article|post|entry|content|story|body/i.test(element.className || element.id || "") ? 350 : 0;
  const sizePenalty = rect.height > window.innerHeight * 8 ? 250 : 0;
  const linkPenalty = linkDensity > 0.45 ? 1200 : linkDensity * 700;
  return semanticBonus + contentClassBonus + Math.min(textLength, 12000) / 5 + paragraphCount * 80 + headingCount * 45 - linkPenalty - sizePenalty;
}

function collectArticleSegments(root, rule) {
  const ruleCandidates = collectRuleCandidates(rule);
  const shouldUseGenericBlocks = rule.bodyHeuristic !== false || !(rule.selectors || []).length;
  const strictCandidates = shouldUseGenericBlocks
    ? [...root.querySelectorAll(ARTICLE_BLOCK_SELECTOR)]
      .filter((element) => isTranslatableElement(element, rule))
      .filter((element) => !hasTranslatedAncestor(element))
      .filter((element) => !containsLargerCandidate(element))
    : [];

  const candidates = sortByDocumentOrder(uniqueElements([...ruleCandidates, ...strictCandidates]));
  const strictSegments = buildSegments(candidates, rule);
  if (strictSegments.length) return strictSegments;

  return shouldUseGenericBlocks ? buildSegments(collectFallbackBlocks(root, rule), rule) : [];
}

function collectRuleCandidates(rule) {
  return sortByDocumentOrder(uniqueElements((rule.selectors || [])
    .flatMap((selector) => safeQueryAll(document, selector))))
    .filter((element) => isTranslatableElement(element, rule))
    .filter((element) => !hasTranslatedAncestor(element))
    .filter((element) => !hasNestedRuleCandidate(element, rule));
}

function buildSegments(candidates, rule) {
  const seen = new Set();
  const segments = [];

  for (const element of candidates) {
    const rich = extractRichText(element);
    const key = normalizeDuplicateKey(rich.plainText);
    if (!shouldTranslateText(rich.plainText, element, rule) || seen.has(key)) continue;
    seen.add(key);
    const id = `article-${segments.length + 1}`;
    element.dataset.translyArticleId = id;
    segments.push({
      id,
      text: rich.text,
      plainText: rich.plainText,
      placeholders: rich.placeholders,
      element,
      path: describeElement(element)
    });
  }

  return segments;
}

function collectFallbackBlocks(root, rule) {
  return [...root.querySelectorAll(ARTICLE_FALLBACK_BLOCK_SELECTOR)]
    .filter((element) => isTranslatableElement(element, rule))
    .filter((element) => !hasTranslatedAncestor(element))
    .filter((element) => element !== root || root === document.body)
    .filter((element) => !hasNestedTextBlock(element, rule))
    .filter((element) => {
      const text = compactText(element.innerText || element.textContent);
      if (text.length > (rule.fallbackMaxTextChars || ARTICLE_FALLBACK_MAX_TEXT_CHARS)) return false;
      return shouldTranslateText(text, element, rule);
    });
}

function isTranslatableElement(element, rule) {
  if (!element || isExcludedElement(element, rule)) return false;
  if (!isVisible(element)) return false;
  if (safeMatches(element, "td,th") && safeClosest(element, "table")?.querySelectorAll("td,th").length > 80) return false;
  if (safeMatches(element, "li") && element.querySelector("p,blockquote,h1,h2,h3,h4,h5,h6")) return false;
  const style = getComputedStyle(element);
  if (style.userSelect === "none" && compactText(element.innerText).length < 80) return false;
  return true;
}

function hasTranslatedAncestor(element) {
  return Boolean(element.closest("[data-transly-translated='true']"));
}

function containsLargerCandidate(element) {
  if (/^H[1-6]$|^P$|^LI$|^BLOCKQUOTE$|^FIGCAPTION$|^TD$|^TH$/.test(element.tagName)) return false;
  return Boolean(element.querySelector("p,li,blockquote,h1,h2,h3,h4,h5,h6"));
}

function hasNestedTextBlock(element, rule) {
  for (const child of element.children) {
    if (isExcludedElement(child, rule)) continue;
    const text = compactText(child.innerText || child.textContent);
    if (text.length < (rule.minTextChars || ARTICLE_MIN_TEXT_CHARS)) continue;
    if (safeMatches(child, ARTICLE_BLOCK_SELECTOR) || safeMatches(child, ARTICLE_FALLBACK_BLOCK_SELECTOR) || isBlockLike(child)) {
      return true;
    }
    if (hasNestedTextBlock(child, rule)) return true;
  }
  return false;
}

function hasNestedRuleCandidate(element, rule) {
  if (!(rule.selectors || []).length) return false;
  return (rule.selectors || []).some((selector) => {
    try {
      return Boolean(element.querySelector(selector));
    } catch {
      return false;
    }
  });
}

function isBlockLike(element) {
  const display = getComputedStyle(element).display;
  return display === "block"
    || display === "list-item"
    || display === "table-cell"
    || display === "table-row"
    || display === "flex"
    || display === "grid";
}

function shouldTranslateText(text, element, rule) {
  if (text.length < (rule.minTextChars || ARTICLE_MIN_TEXT_CHARS)) return false;
  if (/^[\d\s.,:;!?()[\]{}'"“”‘’/\-+*=|@#$%^&~`]+$/.test(text)) return false;
  if (/^[A-Z0-9_.:/-]{2,80}$/.test(text)) return false;
  if (safeMatches(element, "a") && text.length < 80) return false;
  const words = text.match(/\p{L}+/gu) || [];
  return words.length >= (rule.minWords || 3) || text.length >= 60;
}

function buildArticleContext(segments, maxChars) {
  const headings = [...document.querySelectorAll("h1,h2,h3")]
    .filter((element) => isVisible(element) && !isExcludedElement(element, ARTICLE_GENERIC_RULE))
    .map((element) => compactText(element.innerText || element.textContent))
    .filter(Boolean)
    .slice(0, 30);

  const orderedText = segments
    .map((item) => `[${item.id}] ${item.plainText || item.text}`)
    .join("\n")
    .slice(0, maxChars);

  return [
    `Title: ${document.title}`,
    `URL: ${location.href}`,
    headings.length ? `Headings:\n${headings.join("\n")}` : "",
    `Full article text in page order, capped at ${maxChars} chars:\n${orderedText}`
  ].filter(Boolean).join("\n\n");
}

function buildFallbackArticleContext(root) {
  const headings = [...document.querySelectorAll("h1,h2,h3")]
    .filter((element) => isVisible(element))
    .map((element) => compactText(element.innerText || element.textContent))
    .filter(Boolean)
    .slice(0, 30);
  const rootText = compactText(root?.innerText || document.body?.innerText || "").slice(0, ARTICLE_CONTEXT_CHARS);

  return [
    `Title: ${document.title}`,
    `URL: ${location.href}`,
    headings.length ? `Headings:\n${headings.join("\n")}` : "",
    rootText ? `Visible page text sample:\n${rootText}` : ""
  ].filter(Boolean).join("\n\n");
}

function renderArticleTranslations(batch, translations, targetLanguage) {
  const byId = new Map(translations.map((item) => [item.id, item.translation]));
  let count = 0;

  for (const item of batch) {
    const translation = normalizeMultilineText(byId.get(item.id));
    removeExistingTranslation(item.element);
    if (!translation) continue;

    const node = createTranslationNode(item, {
      text: translation,
      targetLanguage
    });
    insertTranslationNode(item.element, node);
    count++;
  }

  return count;
}

async function runArticleAuditRepair({ runId, phase, targetLanguage, root, rule, translatedSegments, settings, context }) {
  if (settings.enableArticleAuditLoop === false) return { enabled: false, repairedCount: 0, actionCount: 0 };
  if (runId !== articleRunId) return { enabled: true, cancelled: true, repairedCount: 0, actionCount: 0 };

  const audit = buildArticleAuditSnapshot(root, rule, translatedSegments, {
    phase,
    maxBlocks: Number(settings.articleAuditMaxBlocks || ARTICLE_AUDIT_MAX_BLOCKS)
  });
  if (!audit.blocks.length) return { enabled: true, repairedCount: 0, actionCount: 0, blockCount: 0 };

  showToast(phase === "initial" ? "AI is checking article blocks..." : "AI is checking translation coverage...");
  const response = await requestArticleAudit({
    mode: "article-audit",
    targetLanguage,
    url: location.href,
    title: document.title,
    auditKey: await sha256(["article-audit", phase, location.href, audit.signature].join("\n")),
    summary: audit.summary,
    blocks: audit.blocks
  });

  const maxRepairItems = Number(settings.articleAuditMaxRepairItems || ARTICLE_AUDIT_MAX_REPAIR_ITEMS);
  const repairIds = new Set((response.actions || [])
    .filter((action) => (action.type === "translate_missing" || action.type === "retranslate") && Number(action.confidence || 0) >= 0.45)
    .slice(0, maxRepairItems)
    .map((action) => action.blockId));

  const repairItems = audit.items
    .filter((item) => repairIds.has(item.auditId))
    .slice(0, maxRepairItems)
    .map((item, index) => prepareRepairSegment(item, index));

  if (!repairItems.length) {
    return {
      enabled: true,
      repairedCount: 0,
      actionCount: response.actions?.length || 0,
      blockCount: audit.blocks.length,
      notes: response.notes || []
    };
  }

  markBatch(repairItems, "working");
  try {
    const cacheKey = await sha256([
      "article-repair",
      location.href,
      targetLanguage,
      repairItems.map((item) => `${item.id}:${item.text}`).join("\n")
    ].join("\n"));
    const repairContext = [
      context || buildFallbackArticleContext(root),
      "",
      "AI audit selected these visible blocks for repair after checking translation coverage."
    ].join("\n");
    const translated = await requestTranslation({
      mode: "article",
      targetLanguage,
      url: location.href,
      title: document.title,
      context: repairContext,
      cacheKey,
      items: repairItems.map(({ id, text }) => ({ id, text }))
    });
    const repairedCount = renderArticleTranslations(repairItems, translated.items || [], targetLanguage);
    markBatch(repairItems, "done");
    return {
      enabled: true,
      repairedCount,
      batchCount: 1,
      actionCount: response.actions?.length || 0,
      blockCount: audit.blocks.length,
      notes: response.notes || []
    };
  } catch (error) {
    markBatch(repairItems, "idle");
    throw error;
  }
}

function buildArticleAuditSnapshot(root, rule, translatedSegments, options = {}) {
  const phase = options.phase || "post-translate";
  const existingElements = new Set((translatedSegments || []).map((item) => item.element));
  const candidates = collectAuditCandidates(root, rule);
  const items = [];
  const blocks = [];
  const seen = new Set();

  for (const element of candidates) {
    const rich = extractRichText(element);
    const key = normalizeDuplicateKey(rich.plainText);
    if (!shouldAuditText(rich.plainText, element, rule) || seen.has(key)) continue;
    seen.add(key);

    const translationNode = getTranslationNode(element);
    const hasTranslation = Boolean(translationNode);
    const sourceLinkCount = element.querySelectorAll("a[href]").length;
    const translationLinkCount = translationNode?.querySelectorAll("a[href]").length || 0;
    const translationTextChars = compactText(translationNode?.innerText || translationNode?.textContent).length;
    const reason = getAuditReason({
      phase,
      element,
      hasTranslation,
      sourceLinkCount,
      translationLinkCount,
      sourceTextChars: rich.plainText.length,
      translationTextChars,
      wasInitialSegment: existingElements.has(element)
    });
    if (!reason) continue;

    const auditId = `audit-${items.length + 1}`;
    const rect = element.getBoundingClientRect();
    const item = {
      auditId,
      element,
      text: rich.text,
      plainText: rich.plainText,
      placeholders: rich.placeholders,
      path: describeElement(element)
    };
    items.push(item);
    blocks.push({
      id: auditId,
      reason,
      path: item.path,
      tag: element.tagName.toLowerCase(),
      textSample: rich.plainText.slice(0, ARTICLE_AUDIT_SAMPLE_CHARS),
      textChars: rich.plainText.length,
      hasTranslation,
      sourceLinkCount,
      translationLinkCount,
      translationTextChars,
      rect: {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      ancestorHints: getAncestorHints(element)
    });

    if (blocks.length >= (options.maxBlocks || ARTICLE_AUDIT_MAX_BLOCKS)) break;
  }

  return {
    items,
    blocks,
    signature: blocks.map((block) => `${block.path}:${block.textChars}:${block.reason}`).join("|"),
    summary: {
      phase,
      url: location.href,
      title: document.title,
      rule: rule.name || "generic",
      translatedBlockCount: translatedSegments?.length || 0,
      candidateBlockCount: candidates.length,
      suspectBlockCount: blocks.length,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollY: Math.round(window.scrollY)
      }
    }
  };
}

function collectAuditCandidates(root, rule) {
  const auditRule = {
    ...ARTICLE_GENERIC_RULE,
    relaxedAudit: true,
    minTextChars: Math.min(rule?.minTextChars || ARTICLE_MIN_TEXT_CHARS, 8),
    minWords: 1,
    fallbackMaxTextChars: Math.max(rule?.fallbackMaxTextChars || ARTICLE_FALLBACK_MAX_TEXT_CHARS, ARTICLE_FALLBACK_MAX_TEXT_CHARS)
  };
  const primary = safeQueryAll(root, ARTICLE_AUDIT_BLOCK_SELECTOR)
    .filter((element) => isTranslatableElement(element, auditRule))
    .filter((element) => !containsLargerCandidate(element));
  const fallback = safeQueryAll(root, ARTICLE_FALLBACK_BLOCK_SELECTOR)
    .filter((element) => isTranslatableElement(element, auditRule))
    .filter((element) => element !== root || root === document.body)
    .filter((element) => !hasNestedTextBlock(element, auditRule))
    .filter((element) => {
      const text = compactText(element.innerText || element.textContent);
      if (text.length > (auditRule.fallbackMaxTextChars || ARTICLE_FALLBACK_MAX_TEXT_CHARS)) return false;
      return shouldAuditText(text, element, auditRule);
    });
  const textLeaves = collectAuditTextLeaves(root, auditRule);
  return sortByDocumentOrder(uniqueElements([...primary, ...fallback, ...textLeaves]))
    .filter((element) => !safeClosest(element, ".transly-translation"))
    .slice(0, ARTICLE_MAX_ITEMS * 2);
}

function collectAuditTextLeaves(root, auditRule) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_REJECT;
      if (isExcludedElement(node, auditRule)) return NodeFilter.FILTER_REJECT;
      if (safeMatches(node, ARTICLE_AUDIT_BLOCK_SELECTOR)) return NodeFilter.FILTER_SKIP;
      if (!isTranslatableElement(node, auditRule)) return NodeFilter.FILTER_SKIP;
      const text = compactText(node.innerText || node.textContent);
      if (!shouldAuditText(text, node, auditRule)) return NodeFilter.FILTER_SKIP;
      const textChildCount = [...node.children].filter((child) => {
        if (!(child instanceof HTMLElement) || !isTranslatableElement(child, auditRule)) return false;
        return shouldAuditText(compactText(child.innerText || child.textContent), child, auditRule);
      }).length;
      return textChildCount ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT;
    }
  });
  const elements = [];
  let node = walker.nextNode();
  while (node && elements.length < ARTICLE_MAX_ITEMS * 2) {
    elements.push(node);
    node = walker.nextNode();
  }
  return elements;
}

function shouldAuditText(text, element, rule) {
  if (safeMatches(element, "a") && text.length < 80) return false;
  if (text.length < Math.min(rule.minTextChars || ARTICLE_MIN_TEXT_CHARS, 8)) return false;
  if (/^[\d\s.,:;!?()[\]{}'"“”‘’/\-+*=|@#$%^&~`]+$/.test(text)) return false;
  const words = text.match(/\p{L}+/gu) || [];
  return words.length >= 1 || text.length >= 24;
}

function getAuditReason(details) {
  if (details.phase === "initial") return "candidate_visible_text_before_initial_translation";
  if (!details.hasTranslation) return "visible_text_without_translation_after_translation";
  if (details.sourceLinkCount > 0 && details.translationLinkCount < details.sourceLinkCount) {
    return "translation_may_have_lost_links";
  }
  if (details.sourceTextChars >= 80 && details.translationTextChars > 0 && details.translationTextChars < details.sourceTextChars * 0.18) {
    return "translation_is_suspiciously_short";
  }
  return "";
}

function prepareRepairSegment(item, index) {
  const id = `repair-${index + 1}`;
  return {
    id,
    text: item.text,
    plainText: item.plainText,
    placeholders: item.placeholders,
    element: item.element,
    path: item.path
  };
}

function getTranslationNode(element) {
  const id = element.dataset.translyArticleId;
  const next = element.nextElementSibling;
  if (!id || !next?.classList?.contains("transly-translation")) return null;
  return next.dataset.translyFor === id ? next : null;
}

function getAncestorHints(element) {
  const hints = [];
  for (let node = element; node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && hints.length < 5; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const classes = typeof node.className === "string"
      ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((item) => `.${item}`).join("")
      : "";
    hints.push(`${tag}${id}${classes}`);
  }
  return hints;
}

function markBatch(batch, state) {
  for (const item of batch) {
    const working = state === "working";
    item.element.classList.toggle("transly-working", working);
    item.element.classList.toggle("transly-error", state === "error");
    if (working) {
      ensureLoadingTranslation(item);
    } else if (state === "idle") {
      removeExistingTranslation(item.element);
    }
  }
}

function ensureLoadingTranslation(item) {
  removeExistingTranslation(item.element);
  const node = createTranslationNode(item, {
    text: "",
    loading: true
  });
  node.setAttribute("aria-label", "Translating");
  const inner = node.querySelector(".transly-target-inner") || node;
  const pill = document.createElement("span");
  pill.className = "transly-loading-pill";
  pill.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index++) {
    const dot = document.createElement("span");
    dot.className = "transly-loading-dot";
    dot.style.animationDelay = `${index * 120}ms`;
    pill.appendChild(dot);
  }
  inner.appendChild(pill);
  insertTranslationNode(item.element, node);
}

function createTranslationNode(item, options = {}) {
  const node = document.createElement("span");
  node.className = "transly-translation transly-target-wrapper notranslate";
  node.dataset.translyFor = item.id;
  node.dataset.translyTheme = "default";
  node.setAttribute("translate", "no");
  if (options.targetLanguage) node.setAttribute("lang", options.targetLanguage);
  if (options.loading) node.classList.add("transly-loading");

  const block = document.createElement("span");
  block.className = "transly-translation-block-wrapper";
  const inner = document.createElement("span");
  inner.className = "transly-target-inner";
  inner.dataset.translyTranslationElement = "1";

  if (!options.loading && options.text) {
    appendTranslatedContent(inner, item, options.text);
  }

  block.appendChild(inner);
  node.appendChild(block);
  item.element.dataset.translyArticleId = item.id;
  item.element.dataset.translyTranslated = "true";
  return node;
}

function insertTranslationNode(source, node) {
  attachTranslationSpacing(source, node);
  source.insertAdjacentElement("afterend", node);
}

function attachTranslationSpacing(source, node) {
  if (!source || !node) return;
  const style = getComputedStyle(source);
  const sourceMarginBottom = parseFloat(style.marginBottom) || 0;
  const sourceFontSize = parseFloat(style.fontSize) || 16;
  if (sourceMarginBottom < sourceFontSize * 0.35) return;

  if (!source.dataset.translyOriginalMarginBottomStyle) {
    source.dataset.translyOriginalMarginBottomStyle = source.style.marginBottom || " ";
  }
  if (!source.dataset.translyOriginalMarginBottomPx) {
    source.dataset.translyOriginalMarginBottomPx = String(sourceMarginBottom);
  }

  const compactGap = Math.min(10, Math.max(4, sourceFontSize * 0.22));
  const translationBottomGap = Math.max(0, sourceMarginBottom - compactGap);
  source.style.marginBottom = `${compactGap}px`;
  node.style.marginBottom = `${translationBottomGap}px`;
}

function restoreTranslationSpacing(source) {
  if (!source?.dataset?.translyOriginalMarginBottomPx) return;
  const original = source.dataset.translyOriginalMarginBottomStyle || "";
  if (original.trim()) source.style.marginBottom = original;
  else source.style.removeProperty("margin-bottom");
  delete source.dataset.translyOriginalMarginBottomStyle;
  delete source.dataset.translyOriginalMarginBottomPx;
}

function appendTranslatedContent(container, item, text) {
  const sourceText = String(text || "");
  let cursor = 0;
  let trimLeadingInlineSpace = false;
  let activeLink = null;
  ARTICLE_PLACEHOLDER_RE.lastIndex = 0;

  const appendText = (value) => {
    const target = activeLink || container;
    target.appendChild(document.createTextNode(value));
  };

  const appendNode = (node) => {
    const target = activeLink || container;
    target.appendChild(node);
  };

  for (const match of sourceText.matchAll(ARTICLE_PLACEHOLDER_RE)) {
    const placeholder = item.placeholders?.[Number(match[1])];
    if (match.index > cursor) {
      let chunk = sourceText.slice(cursor, match.index);
      if (trimLeadingInlineSpace) {
        chunk = chunk.replace(/^[ \t\f\v]+/, "");
        trimLeadingInlineSpace = false;
      }
      if (placeholder?.type === "lineBreak") chunk = chunk.replace(/[ \t\f\v]+$/, "");
      appendText(chunk);
    }

    if (placeholder?.type === "lineBreak") {
      appendText(placeholder.value);
      trimLeadingInlineSpace = true;
    } else if (placeholder?.type === "linkStart") {
      const clone = placeholder.node.cloneNode(false);
      clone.classList?.add("transly-stay-original");
      clone.setAttribute?.("translate", "no");
      applyInlineStyle(clone, placeholder.style);
      appendNode(clone);
      activeLink = clone;
    } else if (placeholder?.type === "linkEnd") {
      activeLink = null;
    } else if (placeholder) {
      const originalNode = placeholder.node || placeholder;
      const clone = originalNode.cloneNode(true);
      clone.classList?.add("transly-stay-original");
      clone.setAttribute?.("translate", "no");
      appendNode(clone);
    } else {
      appendText(match[0]);
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < sourceText.length) {
    let chunk = sourceText.slice(cursor);
    if (trimLeadingInlineSpace) chunk = chunk.replace(/^[ \t\f\v]+/, "");
    appendText(chunk);
  }
}

function removeExistingTranslation(element) {
  const id = element.dataset.translyArticleId;
  if (!id) return;
  const next = element.nextElementSibling;
  if (next?.classList?.contains("transly-translation") && next.dataset.translyFor === id) {
    next.remove();
  }
  restoreTranslationSpacing(element);
}

function clearArticleTranslations(options = {}) {
  if (options.cancelActiveRun !== false) articleRunId++;
  document.querySelectorAll(".transly-translation").forEach((node) => node.remove());
  document.querySelectorAll("[data-transly-article-id]").forEach((node) => {
    node.classList.remove("transly-working", "transly-error");
    restoreTranslationSpacing(node);
    delete node.dataset.translyArticleId;
    delete node.dataset.translyTranslated;
  });
  if (!options.quiet) showToast("Article translations cleared.", { timeout: 1800 });
}

function extractRichText(element) {
  const protectedElements = [...element.querySelectorAll(ARTICLE_PROTECTED_INLINE_SELECTOR)]
    .filter((node) => !safeClosest(node.parentElement, ARTICLE_PROTECTED_INLINE_SELECTOR));
  if (!protectedElements.length) {
    const placeholders = [];
    const rawText = normalizeMultilineText(element.innerText || element.textContent);
    const text = encodeLineBreakPlaceholders(rawText, placeholders);
    return { text, plainText: compactText(rawText), placeholders };
  }

  const clone = element.cloneNode(true);
  const cloneProtected = [...clone.querySelectorAll(ARTICLE_PROTECTED_INLINE_SELECTOR)]
    .filter((node) => !safeClosest(node.parentElement, ARTICLE_PROTECTED_INLINE_SELECTOR));
  const placeholders = [];

  cloneProtected.forEach((node, index) => {
    const original = protectedElements[index];
    if (!original) return;
    if (safeMatches(original, "a[href]")) {
      const startToken = `${ARTICLE_PLACEHOLDER_PREFIX}${placeholders.length}]]`;
      placeholders.push({
        type: "linkStart",
        node: original.cloneNode(false),
        style: captureLinkStyle(original)
      });
      const endToken = `${ARTICLE_PLACEHOLDER_PREFIX}${placeholders.length}]]`;
      placeholders.push({ type: "linkEnd" });
      const linkText = normalizeMultilineText(original.innerText || original.textContent || original.href);
      node.replaceWith(document.createTextNode(` ${startToken} ${linkText} ${endToken} `));
      return;
    }

    const token = `${ARTICLE_PLACEHOLDER_PREFIX}${placeholders.length}]]`;
    placeholders.push({ type: "node", node: original.cloneNode(true) });
    node.replaceWith(document.createTextNode(` ${token} `));
  });

  const rawText = normalizeMultilineText(clone.innerText || clone.textContent);
  const text = encodeLineBreakPlaceholders(rawText, placeholders);
  const plainText = normalizeMultilineText(element.innerText || element.textContent);
  return {
    text,
    plainText: compactText(plainText),
    placeholders
  };
}

function captureLinkStyle(link) {
  const style = getComputedStyle(link);
  return {
    color: style.color,
    cursor: style.cursor,
    textDecorationColor: style.textDecorationColor,
    textDecorationLine: style.textDecorationLine,
    textDecorationSkipInk: style.textDecorationSkipInk,
    textDecorationStyle: style.textDecorationStyle,
    textDecorationThickness: style.textDecorationThickness,
    textUnderlineOffset: style.textUnderlineOffset
  };
}

function applyInlineStyle(element, style = {}) {
  Object.entries(style).forEach(([key, value]) => {
    if (!value) return;
    element.style[key] = value;
  });
}

function requestTranslation(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "TRANSLY_TRANSLATE", payload }, (response) => {
      if (response?.ok) resolve(response.data);
      else reject(new Error(response?.error || "Translation failed"));
    });
  });
}

function requestArticleAudit(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "TRANSLY_AUDIT_ARTICLE", payload }, (response) => {
      if (response?.ok) resolve(response.data);
      else reject(new Error(response?.error || "Article audit failed"));
    });
  });
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "TRANSLY_GET_SETTINGS" }, (response) => {
      resolve(response?.data || {});
    });
  });
}

function showToast(text, options = {}) {
  let toast = document.querySelector("#transly-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "transly-toast";
    toast.className = "transly-toast";
    document.documentElement.appendChild(toast);
  }
  toast.textContent = text;
  toast.dataset.tone = options.tone || "info";
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, options.timeout || 2600);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function encodeLineBreakPlaceholders(text, placeholders) {
  return normalizeMultilineText(text).replace(/\n+/g, (lineBreaks) => {
    const token = `${ARTICLE_PLACEHOLDER_PREFIX}${placeholders.length}]]`;
    placeholders.push({
      type: "lineBreak",
      value: lineBreaks.length > 1 ? "\n\n" : "\n"
    });
    return ` ${token} `;
  });
}

function normalizeDuplicateKey(text) {
  return compactText(text).toLowerCase().slice(0, 400);
}

function chunkItems(items, maxChars) {
  const chunks = [];
  let current = [];
  let size = 0;
  const limit = Math.max(3000, maxChars || ARTICLE_BATCH_CHARS);

  for (const item of items) {
    const itemSize = item.text.length + item.id.length + 64;
    if (current.length && size + itemSize > limit) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function uniqueElements(elements) {
  return [...new Set(elements)];
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeQueryAll(root, selector) {
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function safeMatches(element, selector) {
  try {
    return Boolean(element?.matches(selector));
  } catch {
    return false;
  }
}

function safeClosest(element, selector) {
  try {
    return element?.closest(selector) || null;
  } catch {
    return null;
  }
}

function sortByDocumentOrder(elements) {
  return [...elements].sort((a, b) => {
    if (a === b) return 0;
    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

function getExcludeSelectors(rule) {
  if (rule?.relaxedAudit) return ARTICLE_AUDIT_EXCLUDE_SELECTORS;
  return [...ARTICLE_EXCLUDE_SELECTORS, ...(rule?.excludeSelectors || [])].filter(Boolean);
}

function isExcludedElement(element, rule) {
  return getExcludeSelectors(rule).some((selector) => safeClosest(element, selector));
}

function isVisible(element) {
  return !isVisuallyHidden(element);
}

function isVisuallyHidden(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;

  for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
    if (safeMatches(node, "[hidden], [inert], [aria-hidden='true'], [aria-hidden=true]")) return true;

    const style = getComputedStyle(node);
    if (style.display === "none") return true;
    if (style.visibility === "hidden" || style.visibility === "collapse") return true;
    if (Number(style.opacity || 1) === 0) return true;
    const displayContents = style.display === "contents";

    const classAndId = `${typeof node.className === "string" ? node.className : ""} ${node.id || ""}`;
    if (/\b(sr-only|visually-hidden|screen-reader(?:-text)?|a11y-hidden|hidden-visually|u-hiddenVisually)\b/i.test(classAndId)) {
      return true;
    }

    const clip = style.clip;
    const clipPath = style.clipPath || style.webkitClipPath || "";
    if (clip && clip !== "auto" && clip !== "rect(auto, auto, auto, auto)") return true;
    if (clipPath && clipPath !== "none") return true;

    if (!displayContents && node !== document.body && node !== document.documentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return true;

      const overflowHidden = style.overflow === "hidden"
        || style.overflowX === "hidden"
        || style.overflowY === "hidden";
      const positioned = style.position === "absolute" || style.position === "fixed";
      if ((rect.width <= 2 || rect.height <= 2) && (overflowHidden || positioned)) return true;

      const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
      if (viewportWidth && (rect.right <= 0 || rect.left >= viewportWidth)) return true;
    }
  }

  return false;
}

function describeElement(element) {
  const parts = [];
  let node = element;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && parts.length < 5) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const cls = typeof node.className === "string" && node.className
      ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    parts.unshift(`${tag}${id}${cls}`);
    node = node.parentElement;
  }
  return parts.join(" > ");
}
