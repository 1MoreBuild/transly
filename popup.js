const targetLanguage = document.querySelector("#targetLanguage");
const statusEl = document.querySelector("#status");
const connectionBadge = document.querySelector("#connectionBadge");
const connectionLabel = document.querySelector("#connectionLabel");
const modelValue = document.querySelector("#modelValue");
const articleDisplayMode = document.querySelector("#articleDisplayMode");
const translateArticle = document.querySelector("#translateArticle");
const clearArticle = document.querySelector("#clearArticle");
const articleState = document.querySelector("#articleState");
const subtitleToggle = document.querySelector("#subtitleToggle");
const subtitleState = document.querySelector("#subtitleState");
const popupParams = new URLSearchParams(location.search);
const sourceTabId = Number(popupParams.get("tabId") || 0);

initialize();

async function initialize() {
  await Promise.all([loadNativeHealth(), loadSettings(), loadPageState()]);
}

async function loadNativeHealth() {
  const response = await sendRuntimeMessage({ type: "TRANSLY_NATIVE_HEALTH" });
  if (response?.ok && response.data?.credentials?.available !== false) {
    const model = response.data.model || "Codex";
    connectionBadge.dataset.state = "ready";
    connectionLabel.textContent = "Connected";
    modelValue.textContent = model;
    modelValue.title = model;
    showStatus("Local Native Host is ready.", "ready");
    return;
  }

  connectionBadge.dataset.state = "error";
  connectionLabel.textContent = response?.ok ? "Login required" : "Offline";
  modelValue.textContent = "Unavailable";
  showStatus(
    response?.data?.credentials?.error || response?.error || "Codex ChatGPT login is unavailable.",
    "error"
  );
}

async function loadSettings() {
  const response = await sendRuntimeMessage({ type: "TRANSLY_GET_SETTINGS" });
  if (!response?.ok) return;
  setTargetLanguage(response.data.targetLanguage || "zh-CN");
  updateArticleDisplayMode(response.data.articleDisplayMode || "bilingual");
}

async function loadPageState() {
  try {
    const message = { type: "TRANSLY_GET_PAGE_STATE" };
    const target = await resolveActiveArticleTarget();
    const response = await sendToTabFrame(target, message);
    if (!response?.ok) return;
    const topResponse = target.frameId === 0
      ? response
      : await sendToTabFrame({ tabId: target.tabId, frameId: 0 }, message).catch(() => null);
    updateArticleState(response.data.articleStatus || (response.data.articleTranslated ? "translated" : "idle"));
    updateSubtitleState(Boolean(topResponse?.data?.subtitleEnabled));
  } catch {
    updateArticleState(false);
  }
}

targetLanguage.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: "TRANSLY_SAVE_SETTINGS",
    payload: { targetLanguage: targetLanguage.value }
  });
  showStatus(`Target language set to ${targetLanguage.selectedOptions[0]?.textContent || targetLanguage.value}.`);
});

articleDisplayMode.addEventListener("click", async () => {
  const nextMode = articleDisplayMode.dataset.mode === "translation-only"
    ? "bilingual"
    : "translation-only";
  updateArticleDisplayMode(nextMode);
  await sendRuntimeMessage({
    type: "TRANSLY_SAVE_SETTINGS",
    payload: { articleDisplayMode: nextMode }
  });
  try {
    await sendToActiveTab({
      type: "TRANSLY_SET_ARTICLE_DISPLAY_MODE",
      mode: nextMode
    });
  } catch {
    // The saved mode will apply when a translatable page is opened.
  }
  showStatus(nextMode === "translation-only"
    ? "Showing translations only. Click a translation to reveal its original."
    : "Showing original and translation together.");
});

translateArticle.addEventListener("click", async () => {
  setButtonBusy(translateArticle, true, "Starting translation…");
  showStatus("Reading the page and starting translation…");
  try {
    const response = await sendToActiveTab({
      type: "TRANSLY_TRANSLATE_ARTICLE",
      targetLanguage: targetLanguage.value
    });
    if (response?.ok === false) throw new Error(response.error || "Translation failed");
    updateArticleState("running");
    showStatus("Translation started. Progress continues on the page.", "ready");
    setTimeout(() => window.close(), 240);
  } catch (error) {
    showStatus(String(error?.message || error), "error");
    setButtonBusy(translateArticle, false, "Translate this article");
  }
});

clearArticle.addEventListener("click", async () => {
  clearArticle.disabled = true;
  showStatus("Removing article translations…");
  try {
    const response = await sendToActiveTab({ type: "TRANSLY_CLEAR_ARTICLE" });
    if (response?.ok === false) throw new Error(response.error || "Could not clear translations");
    updateArticleState("idle");
    showStatus("Article translations removed.");
  } catch (error) {
    showStatus(String(error?.message || error), "error");
    clearArticle.disabled = false;
  }
});

subtitleToggle.addEventListener("change", async () => {
  const enabled = subtitleToggle.checked;
  subtitleState.textContent = enabled ? "Turning on…" : "Turning off…";
  subtitleToggle.disabled = true;
  showStatus(enabled ? "Enabling bilingual subtitles…" : "Turning subtitles off…");
  try {
    const response = await sendToActiveTab({
      type: enabled ? "TRANSLY_ENABLE_SUBTITLES" : "TRANSLY_DISABLE_SUBTITLES",
      targetLanguage: targetLanguage.value
    });
    if (response?.ok === false) throw new Error(response.error || "Subtitle action failed");
    updateSubtitleState(enabled);
    showStatus(enabled ? "Bilingual subtitles enabled." : "Bilingual subtitles disabled.", enabled ? "ready" : "neutral");
  } catch (error) {
    updateSubtitleState(!enabled);
    showStatus(String(error?.message || error), "error");
  } finally {
    subtitleToggle.disabled = false;
  }
});

function setTargetLanguage(value) {
  if (![...targetLanguage.options].some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    targetLanguage.appendChild(option);
  }
  targetLanguage.value = value;
}

function updateArticleState(status) {
  const normalized = ["running", "translated", "error"].includes(status) ? status : "idle";
  const running = normalized === "running";
  const translated = normalized === "translated";
  translateArticle.disabled = running;
  translateArticle.setAttribute("aria-busy", String(running));
  translateArticle.querySelector("span").textContent = running
    ? "Translation in progress"
    : "Translate this article";
  clearArticle.disabled = normalized === "idle";
  articleState.textContent = running
    ? "Running on this page"
    : translated
      ? "Translated"
      : normalized === "error"
        ? "Last run failed"
        : "Not translated";
}

function updateSubtitleState(enabled) {
  subtitleToggle.checked = enabled;
  subtitleState.textContent = enabled ? "On" : "Off";
}

function updateArticleDisplayMode(mode) {
  const normalized = mode === "translation-only" ? "translation-only" : "bilingual";
  const bilingual = normalized === "bilingual";
  articleDisplayMode.dataset.mode = normalized;
  articleDisplayMode.dataset.tooltip = bilingual
    ? "Bilingual view\nSwitch to translation only"
    : "Translation only\nSwitch to bilingual view";
  articleDisplayMode.setAttribute(
    "aria-label",
    bilingual
      ? "Bilingual view. Switch to translation only."
      : "Translation only. Switch to bilingual view."
  );
}

function setButtonBusy(button, busy, label) {
  button.disabled = busy;
  button.querySelector("span").textContent = label;
  button.setAttribute("aria-busy", String(busy));
}

function showStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
  statusEl.title = message;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function sendToActiveTab(message) {
  if (isArticleFrameMessage(message?.type)) {
    return sendToTabFrame(await resolveActiveArticleTarget(), message);
  }
  const tabId = await resolveActiveTabId();
  return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
}

async function resolveActiveArticleTarget() {
  const tabId = await resolveActiveTabId();
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: inspectArticleFrame
  }).catch(() => []);
  const candidates = frames
    .filter((frame) => frame && Number.isInteger(frame.frameId) && frame.result)
    .map((frame) => ({
      tabId,
      frameId: frame.frameId,
      score: scoreArticleFrame(frame.result, frame.frameId)
    }))
    .sort((left, right) => right.score - left.score || left.frameId - right.frameId);
  return candidates[0] || { tabId, frameId: 0 };
}

function inspectArticleFrame() {
  const bodyTextChars = String(document.body?.innerText || "").trim().length;
  const semanticTextChars = [...document.querySelectorAll("article, main, [role='main']")]
    .reduce((largest, element) => Math.max(largest, String(element.innerText || "").trim().length), 0);
  return {
    bodyTextChars,
    semanticTextChars,
    translationCount: document.querySelectorAll(".transly-translation:not(.transly-loading)").length,
    articleStatus: document.documentElement.dataset.translyArticleStatus || "idle"
  };
}

function scoreArticleFrame(frame, frameId) {
  const runningBonus = frame.articleStatus === "running" ? 2_000_000_000 : 0;
  const translationBonus = Number(frame.translationCount || 0) > 0 ? 1_000_000_000 : 0;
  const semanticChars = Number(frame.semanticTextChars || 0);
  const semanticBonus = semanticChars >= 300 ? 1_000_000 : 0;
  const topFrameTieBreak = frameId === 0 ? 1 : 0;
  return runningBonus + translationBonus + semanticBonus + semanticChars * 4
    + Number(frame.bodyTextChars || 0) + topFrameTieBreak;
}

function sendToTabFrame(target, message) {
  return chrome.tabs.sendMessage(target.tabId, message, { frameId: target.frameId });
}

function isArticleFrameMessage(type) {
  return new Set([
    "TRANSLY_TRANSLATE_ARTICLE",
    "TRANSLY_CLEAR_ARTICLE",
    "TRANSLY_SET_ARTICLE_DISPLAY_MODE",
    "TRANSLY_GET_PAGE_STATE"
  ]).has(type);
}

async function resolveActiveTabId() {
  if (sourceTabId) return sourceTabId;
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }
  if (!tab?.id) throw new Error("No active tab.");
  return tab.id;
}
