const ARTICLE_FRAME_MESSAGES = new Set([
  "TRANSLY_TRANSLATE_ARTICLE",
  "TRANSLY_CLEAR_ARTICLE",
  "TRANSLY_SET_ARTICLE_DISPLAY_MODE",
  "TRANSLY_GET_PAGE_STATE"
]);

type ArticleFrameInspection = {
  bodyTextChars: number;
  semanticTextChars: number;
  translationCount: number;
  articleStatus: string;
};

export async function sendToActiveTab(message: { type?: string; [key: string]: unknown }, sourceTabId = 0) {
  if (ARTICLE_FRAME_MESSAGES.has(message?.type || "")) {
    return sendToTabFrame(await resolveActiveArticleTarget(sourceTabId), message);
  }
  const tabId = await resolveActiveTabId(sourceTabId);
  return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
}

export async function resolveActiveArticleTarget(sourceTabId = 0) {
  const tabId = await resolveActiveTabId(sourceTabId);
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: inspectArticleFrame
  }).catch(() => []);
  const candidates = frames
    .filter((frame): frame is chrome.scripting.InjectionResult<ArticleFrameInspection> =>
      Boolean(frame && Number.isInteger(frame.frameId) && frame.result))
    .map((frame) => ({
      tabId,
      frameId: frame.frameId,
      score: scoreArticleFrame(frame.result as ArticleFrameInspection, frame.frameId)
    }))
    .sort((left, right) => right.score - left.score || left.frameId - right.frameId);
  return candidates[0] || { tabId, frameId: 0 };
}

export function sendToTabFrame(target: { tabId: number; frameId: number }, message: unknown) {
  return chrome.tabs.sendMessage(target.tabId, message, { frameId: target.frameId });
}

function inspectArticleFrame() {
  const bodyTextChars = String(document.body?.innerText || "").trim().length;
  const semanticTextChars = [...document.querySelectorAll<HTMLElement>("article, main, [role='main']")]
    .reduce((largest, element) => Math.max(largest, String(element.innerText || "").trim().length), 0);
  return {
    bodyTextChars,
    semanticTextChars,
    translationCount: document.querySelectorAll(".transly-translation:not(.transly-loading)").length,
    articleStatus: document.documentElement.dataset.translyArticleStatus || "idle"
  };
}

function scoreArticleFrame(frame: ArticleFrameInspection, frameId: number) {
  const runningBonus = frame.articleStatus === "running" ? 2_000_000_000 : 0;
  const translationBonus = Number(frame.translationCount || 0) > 0 ? 1_000_000_000 : 0;
  const semanticChars = Number(frame.semanticTextChars || 0);
  const semanticBonus = semanticChars >= 300 ? 1_000_000 : 0;
  const topFrameTieBreak = frameId === 0 ? 1 : 0;
  return runningBonus + translationBonus + semanticBonus + semanticChars * 4
    + Number(frame.bodyTextChars || 0) + topFrameTieBreak;
}

async function resolveActiveTabId(sourceTabId: number) {
  if (sourceTabId) return sourceTabId;
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  return tab.id;
}
