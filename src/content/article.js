(function initializeArticleContentScript() {
const ARTICLE_BATCH_CHARS = 28000;
const ARTICLE_CONTEXT_CHARS = 36000;
const ARTICLE_AUDIT_MAX_CANDIDATES = 440;
const ARTICLE_MIN_TEXT_CHARS = 24;
const ARTICLE_FALLBACK_MAX_TEXT_CHARS = 2500;
const ARTICLE_AUDIT_MAX_BLOCKS = 60;
const ARTICLE_AUDIT_MAX_REPAIR_ITEMS = 20;
const ARTICLE_AUDIT_SAMPLE_CHARS = 520;
const ARTICLE_NAVIGATION_MAX_ITEMS = 80;
const ARTICLE_NAVIGATION_CONTROL_SELECTOR = "nav a[href],nav button,[role='navigation'] a[href],[role='navigation'] button";
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
  ".transly-translation"
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
  ".transly-translation"
];
const ARTICLE_PROTECTED_INLINE_SELECTOR = [
  "a[href]",
  "br",
  "code", "kbd", "samp", "var",
  "math", "svg", "canvas", "img",
  "math-field", "mjx-container", ".katex", ".MathJax", ".MathJax_Display",
  "[data-math]", "[data-latex]", "[class~='math']", "[class~='latex']",
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
let activeArticleClientRunId = "";
const activeArticleProgressBatches = new Map();
let articleDisplayMode = "bilingual";
let articleRuntimeState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  error: null
};

initializeArticleDisplayMode();
document.addEventListener("click", handleTranslationRevealClick);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TRANSLY_TRANSLATION_PROGRESS") {
    renderArticleTranslationProgress(message.data);
    return false;
  }

  if (message?.type === "TRANSLY_TRANSLATE_ARTICLE") {
    const clientRequestId = crypto.randomUUID();
    activeArticleClientRunId = clientRequestId;
    setArticleRuntimeState("running", { clientRequestId });
    sendResponse({ ok: true, data: { status: "started", clientRequestId } });

    translateArticle(message.targetLanguage || "zh-CN", clientRequestId)
      .then((summary) => {
        if (activeArticleClientRunId !== clientRequestId) return;
        setArticleRuntimeState(summary?.cancelled ? "idle" : "translated", { clientRequestId });
      })
      .catch((error) => {
        console.error("[transly] article translation failed", error);
        if (activeArticleClientRunId === clientRequestId) {
          setArticleRuntimeState("error", {
            clientRequestId,
            error: String(error?.message || error)
          });
        }
      });
    return true;
  }

  if (message?.type === "TRANSLY_SET_ARTICLE_DISPLAY_MODE") {
    setArticleDisplayMode(message.mode);
    sendResponse({ ok: true, data: { articleDisplayMode } });
    return true;
  }

  if (message?.type === "TRANSLY_CLEAR_ARTICLE") {
    activeArticleClientRunId = "";
    clearArticleTranslations();
    setArticleRuntimeState("idle");
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "TRANSLY_GET_PAGE_STATE") {
    sendResponse({
      ok: true,
      data: {
        articleTranslated: Boolean(document.querySelector(".transly-translation:not(.transly-loading)")),
        articleStatus: articleRuntimeState.status,
        articleStartedAt: articleRuntimeState.startedAt,
        articleFinishedAt: articleRuntimeState.finishedAt,
        articleError: articleRuntimeState.error,
        articleDisplayMode,
        clientRequestId: activeArticleClientRunId || null,
        subtitleEnabled: document.documentElement.dataset.translySubtitlesEnabled === "true"
      }
    });
    return true;
  }
});

async function translateArticle(targetLanguage, clientRequestId) {
  const runId = ++articleRunId;
  clearArticleTranslations({ cancelActiveRun: false });

  const rule = getArticleRule();
  if (rule.disabled) {
    throw new Error("This page is excluded by the article rule.");
  }
  const container = findArticleContainer(rule);
  const articleSegments = collectArticleSegments(container, rule);
  if (!articleSegments.length) {
    const settings = await getSettings();
    const recovered = await runArticleAuditRepair({
      runId,
      phase: "initial",
      targetLanguage,
      clientRequestId,
      root: document.body,
      rule,
      translatedSegments: [],
      settings,
      context: buildFallbackArticleContext(document.body)
    });
    if (recovered.cancelled || runId !== articleRunId || clientRequestId !== activeArticleClientRunId) {
      return { cancelled: true };
    }
    if (recovered.repairedCount) {
      return {
        translatedCount: recovered.repairedCount,
        segmentCount: recovered.repairedCount,
        batchCount: recovered.batchCount,
        audit: recovered
      };
    }
    throw new Error(`No article text found. AI audit checked ${recovered.blockCount || 0} candidate blocks and selected no repairable article text.`);
  }

  const navigationSegments = collectNavigationSegments();
  const contextSegments = sortSegmentsByDocumentOrder([...articleSegments, ...navigationSegments]);
  const prioritizeItems = globalThis.TranslyArticleBatching?.prioritizeArticleItems;
  const segments = typeof prioritizeItems === "function"
    ? prioritizeItems(contextSegments, { scrollY: window.scrollY, viewportHeight: window.innerHeight })
    : contextSegments;

  const settings = await getSettings();
  const context = buildArticleContext(contextSegments, Number(settings.articleContextChars || ARTICLE_CONTEXT_CHARS));
  const planner = globalThis.TranslyArticleBatching?.planArticleBatches;
  if (typeof planner !== "function") {
    throw new Error("Article batching runtime is unavailable. Reload the Transly extension.");
  }
  const batchPlans = planner(segments, {
    maxChars: settings.articleBatchChars || ARTICLE_BATCH_CHARS,
    maxItems: settings.articleBatchMaxItems || 28
  });
  const translation = await translateArticleBatches({
    runId,
    clientRequestId,
    targetLanguage,
    segments,
    context,
    batchPlans
  });
  if (translation.cancelled) return { cancelled: true };
  let translatedCount = translation.translatedCount;

  let audit = { enabled: Boolean(settings.enableArticleAuditLoop !== false), repairedCount: 0, actionCount: 0 };
  try {
    audit = await runArticleAuditRepair({
      runId,
      phase: "post-translate",
      targetLanguage,
      clientRequestId,
      root: document.body,
      rule,
      translatedSegments: segments,
      settings,
      context
    });
  } catch (error) {
    if (runId !== articleRunId || clientRequestId !== activeArticleClientRunId) {
      return { cancelled: true };
    }
    console.warn("[transly] article audit failed", error);
    audit = {
      enabled: true,
      failed: true,
      repairedCount: 0,
      actionCount: 0,
      error: String(error?.message || error)
    };
  }
  if (audit.cancelled || runId !== articleRunId || clientRequestId !== activeArticleClientRunId) {
    return { cancelled: true };
  }
  translatedCount += audit.repairedCount;

  return { translatedCount, segmentCount: segments.length, batchCount: batchPlans.length, audit };
}

async function translateArticleBatches({
  runId,
  clientRequestId,
  targetLanguage,
  segments,
  context,
  batchPlans
}) {
  const plans = prioritizeArticleBatches(batchPlans);

  const isActive = () => runId === articleRunId && clientRequestId === activeArticleClientRunId;
  const results = await Promise.allSettled(plans.map(async (plan) => {
    if (!isActive()) return 0;
    return translateArticleBatch({
      plan,
      runId,
      clientRequestId,
      targetLanguage,
      segments,
      context
    });
  }));

  if (!isActive()) return { translatedCount: 0, cancelled: true };
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  return {
    translatedCount: results.reduce((sum, result) => sum + result.value, 0),
    cancelled: false
  };
}

async function translateArticleBatch({
  plan,
  runId,
  clientRequestId,
  targetLanguage,
  segments,
  context
}) {
  const batch = plan.items;
  markBatch(batch, "working");
  try {
    const cacheKey = await sha256([
      "article",
      location.href,
      targetLanguage,
      batch.map((item) => `${item.id}:${item.text}`).join("\n")
    ].join("\n"));
    const phase = "translate";
    registerArticleProgressBatch({
      runId,
      clientRequestId,
      phase,
      batchIndex: plan.batchIndex,
      targetLanguage,
      items: batch
    });
    const response = await requestTranslation({
      mode: "article",
      phase,
      clientRequestId,
      batchIndex: plan.batchIndex,
      batchCount: plan.batchCount,
      sourceBlockCount: segments.length,
      targetLanguage,
      url: location.href,
      title: document.title,
      context,
      cacheKey,
      items: batch.map(({ id, text }) => ({ id, text }))
    });
    if (runId !== articleRunId || clientRequestId !== activeArticleClientRunId) return 0;
    const translatedCount = renderArticleTranslations(batch, response.items || [], targetLanguage);
    markBatch(batch, "done");
    return translatedCount;
  } catch (error) {
    if (runId === articleRunId && clientRequestId === activeArticleClientRunId) {
      markFailedBatch(batch);
    }
    throw error;
  } finally {
    unregisterArticleProgressBatch(clientRequestId, "translate", plan.batchIndex);
  }
}

function registerArticleProgressBatch(details) {
  const key = articleProgressBatchKey(details.clientRequestId, details.phase, details.batchIndex);
  activeArticleProgressBatches.set(key, {
    ...details,
    itemById: new Map(details.items.map((item) => [item.id, item]))
  });
}

function unregisterArticleProgressBatch(clientRequestId, phase, batchIndex) {
  activeArticleProgressBatches.delete(articleProgressBatchKey(clientRequestId, phase, batchIndex));
}

function articleProgressBatchKey(clientRequestId, phase, batchIndex) {
  return `${clientRequestId || ""}:${phase || ""}:${batchIndex || ""}`;
}

function renderArticleTranslationProgress(data) {
  if (data?.mode !== "article" || data.clientRequestId !== activeArticleClientRunId) return;
  const key = articleProgressBatchKey(data.clientRequestId, data.phase, data.batchIndex);
  const active = activeArticleProgressBatches.get(key);
  if (!active || active.runId !== articleRunId) return;
  const selectRenderable = globalThis.TranslyArticleProgress?.selectRenderableProgressItems;
  if (typeof selectRenderable !== "function") return;
  const translations = selectRenderable(active.items, data.items);
  if (!translations.length) return;
  const sourceItems = translations.map((item) => active.itemById.get(item.id)).filter(Boolean);
  renderArticleTranslations(sourceItems, translations, active.targetLanguage);
}

function prioritizeArticleBatches(batchPlans) {
  const viewportTop = window.scrollY;
  const viewportBottom = viewportTop + window.innerHeight;
  return [...batchPlans].sort((left, right) => (
    getBatchViewportDistance(left, viewportTop, viewportBottom)
    - getBatchViewportDistance(right, viewportTop, viewportBottom)
  ));
}

function sortSegmentsByDocumentOrder(segments) {
  const orderedElements = sortByDocumentOrder(segments.map((item) => item.element));
  const orderByElement = new Map(orderedElements.map((element, index) => [element, index]));
  return [...segments].sort((left, right) => (
    (orderByElement.get(left.element) ?? Number.POSITIVE_INFINITY)
    - (orderByElement.get(right.element) ?? Number.POSITIVE_INFINITY)
  ));
}

function getBatchViewportDistance(plan, viewportTop, viewportBottom) {
  let distance = Number.POSITIVE_INFINITY;
  for (const item of plan.items || []) {
    const rect = item.element?.getBoundingClientRect?.();
    if (!rect) continue;
    const top = rect.top + window.scrollY;
    const bottom = rect.bottom + window.scrollY;
    if (bottom >= viewportTop && top <= viewportBottom) return 0;
    distance = Math.min(distance, top > viewportBottom ? top - viewportBottom : viewportTop - bottom);
  }
  return distance;
}

function setArticleRuntimeState(status, options = {}) {
  const now = new Date().toISOString();
  articleRuntimeState = {
    status,
    startedAt: status === "running" ? now : articleRuntimeState.startedAt,
    finishedAt: status === "running" ? null : now,
    error: options.error || null
  };
  if (options.clientRequestId) activeArticleClientRunId = options.clientRequestId;
  document.documentElement.dataset.translyArticleStatus = status;
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

function collectNavigationSegments() {
  const controls = uniqueElements(safeQueryAll(document, ARTICLE_NAVIGATION_CONTROL_SELECTOR));
  const segments = [];

  for (const control of controls) {
    if (segments.length >= ARTICLE_NAVIGATION_MAX_ITEMS) break;
    if (!isVisible(control)) continue;
    const element = findNavigationTextElement(control);
    if (!element || !isVisible(element)) continue;
    const rich = extractRichText(element);
    if (!shouldTranslateNavigationText(rich.translatableText)) continue;

    const id = `navigation-${segments.length + 1}`;
    element.dataset.translyArticleId = id;
    segments.push({
      id,
      text: rich.text,
      plainText: rich.plainText,
      placeholders: rich.placeholders,
      element,
      path: describeElement(element),
      presentation: getNavigationPresentation(control, rich.plainText)
    });
  }

  return segments;
}

function findNavigationTextElement(control) {
  const visibleTextLeaves = safeQueryAll(control, "span")
    .filter((element) => isVisible(element))
    .filter((element) => !safeClosest(element, ".sr-only,.visually-hidden,.screen-reader-text,[aria-hidden='true']"))
    .filter((element) => shouldTranslateNavigationText(compactText(element.innerText || element.textContent)))
    .filter((element) => ![...element.children].some((child) => (
      isVisible(child) && shouldTranslateNavigationText(compactText(child.innerText || child.textContent))
    )));
  if (visibleTextLeaves.length === 1) return visibleTextLeaves[0];

  const directTextNodes = [...control.childNodes].filter((node) => (
    node.nodeType === Node.TEXT_NODE && shouldTranslateNavigationText(compactText(node.textContent))
  ));
  if (directTextNodes.length !== 1) return null;

  const host = document.createElement("span");
  host.className = "transly-navigation-text-host";
  host.dataset.translyNavigationTextHost = "true";
  directTextNodes[0].replaceWith(host);
  host.appendChild(directTextNodes[0]);
  return host;
}

function shouldTranslateNavigationText(text) {
  const normalized = compactText(text);
  if (normalized.length < 2 || normalized.length > 120) return false;
  if (/^(OpenAI|ChatGPT)$/i.test(normalized)) return false;
  if (/^[\d\s.,:;!?()[\]{}'"“”‘’/\-+*=|@#$%^&~`]+$/.test(normalized)) return false;
  return Boolean(normalized.match(/\p{L}/u));
}

function getNavigationPresentation(control, text) {
  const navigation = safeClosest(control, "nav,[role='navigation']");
  const navigationLabel = navigation?.getAttribute("aria-label") || "";
  const isTableOfContents = /table of contents|contents|on this page/i.test(navigationLabel)
    || String(control.getAttribute?.("href") || "").startsWith("#");
  return isTableOfContents && compactText(text).length > 24
    ? "navigation-block"
    : "navigation-inline";
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
    if (!shouldTranslateText(rich.translatableText, element, rule) || seen.has(key)) continue;
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
  const tableCell = globalThis.TranslyArticlePlacement?.closestTableCell(element) || safeClosest(element, "td,th");
  if (tableCell && safeClosest(tableCell, "table")?.querySelectorAll("td,th").length > 80) return false;
  if (safeMatches(element, "li") && element.querySelector("p,blockquote,h1,h2,h3,h4,h5,h6")) return false;
  const style = getComputedStyle(element);
  if (style.userSelect === "none" && compactText(element.innerText).length < 80) return false;
  return true;
}

function hasTranslatedAncestor(element) {
  return Boolean(element.closest("[data-transly-translated='true']"));
}

function containsLargerCandidate(element) {
  if (globalThis.TranslyArticlePlacement?.isTableCell(element) || safeMatches(element, "td,th")) {
    return globalThis.TranslyArticlePlacement?.containsNestedTextBlock(element)
      ?? Boolean(element.querySelector("p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption"));
  }
  if (/^H[1-6]$|^P$|^LI$|^BLOCKQUOTE$|^FIGCAPTION$/.test(element.tagName)) return false;
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
  const inTableCell = Boolean(globalThis.TranslyArticlePlacement?.closestTableCell(element) || safeClosest(element, "td,th"));
  const minTextChars = inTableCell ? 2 : (rule.minTextChars || ARTICLE_MIN_TEXT_CHARS);
  if (text.length < minTextChars) return false;
  if (/^[\d\s.,:;!?()[\]{}'"“”‘’/\-+*=|@#$%^&~`]+$/.test(text)) return false;
  if (/^[A-Z0-9_.:/-]{2,80}$/.test(text)) return false;
  if (safeMatches(element, "a") && text.length < 80) return false;
  const words = text.match(/\p{L}+/gu) || [];
  return words.length >= (inTableCell ? 1 : (rule.minWords || 3)) || text.length >= 60;
}

function buildArticleContext(segments, maxChars) {
  const orderedText = segments
    .map((item) => item.plainText || item.text)
    .join("\n\n")
    .slice(0, maxChars);

  return [
    document.title,
    orderedText
  ].filter(Boolean).join("\n\n");
}

function buildFallbackArticleContext(root) {
  const rootText = compactText(root?.innerText || document.body?.innerText || "").slice(0, ARTICLE_CONTEXT_CHARS);

  return [
    document.title,
    rootText
  ].filter(Boolean).join("\n\n");
}

function renderArticleTranslations(batch, translations, targetLanguage) {
  const byId = new Map(translations.map((item) => [item.id, item.translation]));
  let count = 0;

  for (const item of batch) {
    const translation = normalizeMultilineText(byId.get(item.id));
    const existing = getTranslationNode(item.element);
    if (translation && existing?.translyTranslationText === translation) {
      count++;
      continue;
    }
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

async function runArticleAuditRepair({ runId, phase, targetLanguage, clientRequestId, root, rule, translatedSegments, settings, context }) {
  if (settings.enableArticleAuditLoop === false) return { enabled: false, repairedCount: 0, actionCount: 0 };
  if (runId !== articleRunId) return { enabled: true, cancelled: true, repairedCount: 0, actionCount: 0 };

  const audit = buildArticleAuditSnapshot(root, rule, translatedSegments, {
    phase,
    maxBlocks: Number(settings.articleAuditMaxBlocks || ARTICLE_AUDIT_MAX_BLOCKS)
  });
  if (!audit.blocks.length) return { enabled: true, repairedCount: 0, actionCount: 0, blockCount: 0 };

  const response = await requestArticleAudit({
    mode: "article-audit",
    phase,
    clientRequestId,
    sourceBlockCount: translatedSegments.length,
    targetLanguage,
    url: location.href,
    title: document.title,
    auditKey: await sha256(["article-audit", phase, location.href, audit.signature].join("\n")),
    summary: audit.summary,
    blocks: audit.blocks
  });
  if (runId !== articleRunId || clientRequestId !== activeArticleClientRunId) {
    return { enabled: true, cancelled: true, repairedCount: 0, actionCount: 0 };
  }

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
    const repairContext = context || buildFallbackArticleContext(root);
    const phase = "audit-repair";
    registerArticleProgressBatch({
      runId,
      clientRequestId,
      phase,
      batchIndex: 1,
      targetLanguage,
      items: repairItems
    });
    const translated = await requestTranslation({
      mode: "article",
      phase,
      clientRequestId,
      batchIndex: 1,
      batchCount: 1,
      sourceBlockCount: translatedSegments.length,
      targetLanguage,
      url: location.href,
      title: document.title,
      context: repairContext,
      cacheKey,
      items: repairItems.map(({ id, text }) => ({ id, text }))
    });
    if (runId !== articleRunId || clientRequestId !== activeArticleClientRunId) {
      return { enabled: true, cancelled: true, repairedCount: 0, actionCount: 0 };
    }
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
  } finally {
    unregisterArticleProgressBatch(clientRequestId, "audit-repair", 1);
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
    if (!shouldAuditText(rich.translatableText, element, rule) || seen.has(key)) continue;
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
  const isContaminated = globalThis.TranslyArticleAudit?.isAuditCandidateContaminated;
  if (typeof isContaminated !== "function") {
    throw new Error("Article audit runtime is unavailable. Reload the Transly extension.");
  }
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
    .filter((element) => !isContaminated(element))
    .slice(0, ARTICLE_AUDIT_MAX_CANDIDATES);
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
  while (node && elements.length < ARTICLE_AUDIT_MAX_CANDIDATES) {
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
  if (!id) return null;
  const nested = globalThis.TranslyArticlePlacement?.getNestedTranslation(element, id);
  if (nested) return nested;
  const next = element.nextElementSibling;
  if (!next?.classList?.contains("transly-translation")) return null;
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

function markFailedBatch(batch) {
  for (const item of batch) {
    item.element.classList.remove("transly-working");
    item.element.classList.add("transly-error");
    if (getTranslationNode(item.element)) removeExistingTranslation(item.element);
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
  if (item.presentation === "navigation-inline" || item.presentation === "navigation-block") {
    node.classList.add("transly-translation-navigation", `transly-translation-${item.presentation}`);
  }
  if (!options.loading && options.text) node.translyTranslationText = options.text;

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
  updateTranslationRevealState(node, item.element);
  return node;
}

async function initializeArticleDisplayMode() {
  const settings = await getSettings();
  setArticleDisplayMode(settings.articleDisplayMode);
}

function setArticleDisplayMode(mode) {
  articleDisplayMode = mode === "translation-only" ? "translation-only" : "bilingual";
  document.documentElement.dataset.translyArticleDisplayMode = articleDisplayMode;
  if (articleDisplayMode === "bilingual") {
    document.querySelectorAll(".transly-source-revealed").forEach((source) => {
      source.classList.remove("transly-source-revealed");
    });
  }
  document.querySelectorAll(".transly-translation").forEach((translation) => {
    const source = getSourceForTranslation(translation);
    if (source) updateTranslationRevealState(translation, source);
  });
}

function handleTranslationRevealClick(event) {
  if (articleDisplayMode !== "translation-only") return;
  if (event.target.closest("a, button, input, select, textarea")) return;
  if (window.getSelection()?.toString()) return;
  const translation = event.target.closest(".transly-translation:not(.transly-loading)");
  if (!translation) return;
  const source = getSourceForTranslation(translation);
  if (!source) return;
  source.classList.toggle("transly-source-revealed");
  updateTranslationRevealState(translation, source);
}

function getSourceForTranslation(translation) {
  const source = translation?.previousElementSibling;
  if (source?.dataset.translyArticleId === translation.dataset.translyFor) return source;
  return globalThis.TranslyArticlePlacement?.getTranslationSource(translation) || null;
}

function updateTranslationRevealState(translation, source) {
  if (articleDisplayMode !== "translation-only"
    || translation.classList.contains("transly-loading")
    || translation.classList.contains("transly-translation-navigation")) {
    translation.classList.remove("transly-can-reveal-source");
    translation.removeAttribute("title");
    return;
  }
  const revealed = source.classList.contains("transly-source-revealed");
  translation.classList.add("transly-can-reveal-source");
  translation.title = revealed ? "Click to hide original" : "Click to show original";
}

function insertTranslationNode(source, node) {
  attachTranslationPresentation(source, node);
  if (globalThis.TranslyArticlePlacement?.insertTranslation(source, node)) return;
  source.insertAdjacentElement("afterend", node);
}

function attachTranslationPresentation(source, node) {
  if (!source || !node) return;
  restoreTranslationSpacing(source);
  const style = getComputedStyle(source);
  const sourceMarginBottom = parseFloat(style.marginBottom) || 0;
  const sourceFontSize = parseFloat(style.fontSize) || 16;
  const copiedProperties = [
    "color",
    "fontSize",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "textAlign"
  ];
  for (const property of copiedProperties) {
    if (style[property]) node.style[property] = style[property];
  }
  const resolvedFontWeight = globalThis.TranslyArticleStyle?.resolveTranslationFontWeight(style)
    || style.fontWeight;
  if (resolvedFontWeight) node.style.fontWeight = resolvedFontWeight;

  if (node.classList.contains("transly-translation-navigation")) {
    node.style.marginTop = "0px";
    node.style.marginBottom = "0px";
    return;
  }

  const fallbackGap = Math.min(16, Math.max(8, sourceFontSize * 0.34));
  node.style.marginTop = sourceMarginBottom >= sourceFontSize * 0.35 ? "0px" : `${fallbackGap}px`;
  if (sourceMarginBottom > 0) node.style.marginBottom = `${sourceMarginBottom}px`;
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
  getTranslationNode(element)?.remove();
  globalThis.TranslyArticlePlacement?.restoreSourceParts(element);
  restoreTranslationSpacing(element);
}

function clearArticleTranslations(options = {}) {
  if (options.cancelActiveRun !== false) articleRunId++;
  activeArticleProgressBatches.clear();
  document.querySelectorAll(".transly-translation").forEach((node) => node.remove());
  document.querySelectorAll("[data-transly-article-id]").forEach((node) => {
    node.classList.remove("transly-working", "transly-error", "transly-source-revealed");
    globalThis.TranslyArticlePlacement?.restoreSourceParts(node);
    restoreTranslationSpacing(node);
    delete node.dataset.translyArticleId;
    delete node.dataset.translyTranslated;
  });
  document.querySelectorAll("[data-transly-navigation-text-host='true']").forEach((host) => {
    host.replaceWith(...host.childNodes);
  });
}

function extractRichText(element) {
  const protectedElements = [...element.querySelectorAll(ARTICLE_PROTECTED_INLINE_SELECTOR)]
    .filter((node) => !safeClosest(node.parentElement, ARTICLE_PROTECTED_INLINE_SELECTOR));
  if (!protectedElements.length) {
    const text = compactText(element.innerText || element.textContent);
    return { text, plainText: text, translatableText: text, placeholders: [] };
  }

  const clone = element.cloneNode(true);
  const cloneProtected = [...clone.querySelectorAll(ARTICLE_PROTECTED_INLINE_SELECTOR)]
    .filter((node) => !safeClosest(node.parentElement, ARTICLE_PROTECTED_INLINE_SELECTOR));
  const placeholders = [];

  cloneProtected.forEach((node, index) => {
    const original = protectedElements[index];
    if (!original) return;
    if (safeMatches(original, "br")) {
      const token = `${ARTICLE_PLACEHOLDER_PREFIX}${placeholders.length}]]`;
      placeholders.push({ type: "lineBreak", value: "\n" });
      node.replaceWith(document.createTextNode(` ${token} `));
      return;
    }
    if (safeMatches(original, "a[href]")) {
      const startToken = `${ARTICLE_PLACEHOLDER_PREFIX}${placeholders.length}]]`;
      placeholders.push({
        type: "linkStart",
        node: original.cloneNode(false),
        style: captureLinkStyle(original)
      });
      const endToken = `${ARTICLE_PLACEHOLDER_PREFIX}${placeholders.length}]]`;
      placeholders.push({ type: "linkEnd" });
      const linkText = compactText(original.innerText || original.textContent || original.href);
      node.replaceWith(document.createTextNode(` ${startToken} ${linkText} ${endToken} `));
      return;
    }

    const token = `${ARTICLE_PLACEHOLDER_PREFIX}${placeholders.length}]]`;
    placeholders.push({ type: "node", node: original.cloneNode(true) });
    node.replaceWith(document.createTextNode(` ${token} `));
  });

  const text = compactText(clone.textContent);
  const plainText = compactText(element.innerText || element.textContent);
  const extractTranslatableText = globalThis.TranslyArticleText?.extractTranslatableText;
  if (typeof extractTranslatableText !== "function") {
    throw new Error("Article text runtime is unavailable. Reload the Transly extension.");
  }
  return {
    text,
    plainText,
    translatableText: extractTranslatableText(text),
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

function normalizeDuplicateKey(text) {
  return compactText(text).toLowerCase().slice(0, 400);
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
})();
