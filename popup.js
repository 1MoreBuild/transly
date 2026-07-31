const targetLanguage = document.querySelector("#targetLanguage");
const statusEl = document.querySelector("#status");
const connectionBadge = document.querySelector("#connectionBadge");
const connectionLabel = document.querySelector("#connectionLabel");
const providerValue = document.querySelector("#providerValue");
const providerIcon = document.querySelector("#providerIcon");
const providerFallback = document.querySelector("#providerFallback");
const modelValue = document.querySelector("#modelValue");
const popupModelPicker = document.querySelector("#popupModelPicker");
const popupModelTrigger = document.querySelector("#popupModelTrigger");
const popupModelPopover = document.querySelector("#popupModelPopover");
const popupModelList = document.querySelector("#popupModelList");
const configureProvider = document.querySelector("#configureProvider");
const articleDisplayMode = document.querySelector("#articleDisplayMode");
const translateArticle = document.querySelector("#translateArticle");
const clearArticle = document.querySelector("#clearArticle");
const articleState = document.querySelector("#articleState");
const subtitleToggle = document.querySelector("#subtitleToggle");
const subtitleState = document.querySelector("#subtitleState");
const popupParams = new URLSearchParams(location.search);
const sourceTabId = Number(popupParams.get("tabId") || 0);
let providerReady = false;
let currentArticleStatus = "idle";
let currentModel = "";
let popupModelsLoaded = false;

initialize();

async function initialize() {
  await Promise.all([loadProviderStatus(), loadSettings(), loadPageState()]);
}

async function loadProviderStatus() {
  const response = await sendRuntimeMessage({ type: "TRANSLY_PROVIDER_STATUS" });
  if (response?.ok && response.data?.configured) {
    const model = response.data.model || "Custom model";
    providerReady = true;
    connectionBadge.dataset.state = "ready";
    connectionLabel.textContent = "Configured";
    setProviderPresentation(response.data);
    setCurrentModel(model);
    popupModelTrigger.disabled = false;
    showStatus("Translation service is ready.", "ready");
    updateArticleState(currentArticleStatus);
    updateSubtitleState(subtitleToggle.checked);
    return;
  }

  providerReady = false;
  connectionBadge.dataset.state = "error";
  connectionLabel.textContent = "Setup required";
  setProviderPresentation({});
  setCurrentModel("Not configured");
  popupModelTrigger.disabled = true;
  updateArticleState(currentArticleStatus);
  updateSubtitleState(subtitleToggle.checked);
  showStatus(response?.error || "Add an API URL, key, and model to begin.", "error");
}

configureProvider.addEventListener("click", () => chrome.runtime.openOptionsPage());
popupModelTrigger.addEventListener("click", async () => {
  if (!providerReady) return;
  if (!popupModelPopover.hidden) {
    closePopupModelPicker();
    return;
  }
  openPopupModelPicker();
  if (!popupModelsLoaded) await loadPopupModels();
});

document.addEventListener("pointerdown", (event) => {
  if (!popupModelPopover.hidden && !popupModelPicker.contains(event.target)) closePopupModelPicker();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !popupModelPopover.hidden) {
    closePopupModelPicker();
    popupModelTrigger.focus();
  }
});

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

function setProviderPresentation(summary) {
  const provider = summary?.provider || {};
  providerValue.textContent = provider.name || "AI provider";
  providerValue.title = provider.name || "AI provider";
  if (provider.icon) {
    providerIcon.src = chrome.runtime.getURL(provider.icon);
    providerIcon.hidden = false;
    providerFallback.hidden = true;
  } else {
    providerIcon.removeAttribute("src");
    providerIcon.hidden = true;
    providerFallback.hidden = false;
  }
}

function setCurrentModel(value) {
  currentModel = value;
  modelValue.textContent = splitModelName(value).name || value;
  modelValue.title = value;
}

function openPopupModelPicker() {
  popupModelPopover.hidden = false;
  popupModelTrigger.setAttribute("aria-expanded", "true");
  if (!popupModelsLoaded) renderPopupModelMessage("Loading models…");
}

function closePopupModelPicker() {
  popupModelPopover.hidden = true;
  popupModelTrigger.setAttribute("aria-expanded", "false");
}

async function loadPopupModels() {
  const response = await sendRuntimeMessage({ type: "TRANSLY_LIST_CONFIGURED_MODELS" });
  if (!response?.ok) {
    renderPopupModelMessage(response?.error || "Could not load models.");
    return;
  }
  const models = filterTranslationModels(response.data.models || []);
  popupModelsLoaded = true;
  if (response.data.currentModel) setCurrentModel(response.data.currentModel);
  renderPopupModels(models);
}

function filterTranslationModels(models) {
  const unsupported = /(embedding|whisper|tts|speech|audio|image|dall-e|moderation|realtime|transcrib)/i;
  return [...new Set(models.map((value) => String(value).trim()).filter(Boolean))]
    .filter((value) => !unsupported.test(value))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function renderPopupModels(models) {
  popupModelList.replaceChildren();
  if (!models.length) {
    renderPopupModelMessage("No text models available.");
    return;
  }
  for (const value of models) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "popup-model-option";
    button.dataset.value = value;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(value === currentModel));

    const copy = document.createElement("span");
    copy.className = "popup-model-option-copy";
    const name = document.createElement("span");
    name.className = "popup-model-option-name";
    const provider = document.createElement("span");
    provider.className = "popup-model-option-provider";
    const parts = splitModelName(value);
    name.textContent = parts.name;
    provider.textContent = parts.provider;
    provider.hidden = !parts.provider;
    copy.append(name, provider);

    const check = document.createElement("span");
    check.className = "popup-model-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = value === currentModel ? "✓" : "";
    button.append(copy, check);
    button.addEventListener("click", () => selectPopupModel(value, button));
    popupModelList.append(button);
  }
}

function renderPopupModelMessage(message) {
  popupModelList.replaceChildren();
  const copy = document.createElement("p");
  copy.className = "popup-model-message";
  copy.textContent = message;
  popupModelList.append(copy);
}

async function selectPopupModel(value, button) {
  if (value === currentModel) {
    closePopupModelPicker();
    return;
  }
  button.disabled = true;
  const response = await sendRuntimeMessage({
    type: "TRANSLY_SELECT_PROVIDER_MODEL",
    model: value
  });
  button.disabled = false;
  if (!response?.ok) {
    showStatus(response?.error || "Could not switch models.", "error");
    return;
  }
  setCurrentModel(value);
  setProviderPresentation(response.data);
  [...popupModelList.querySelectorAll(".popup-model-option")].forEach((option) => {
    const selected = option.dataset.value === value;
    option.setAttribute("aria-selected", String(selected));
    option.querySelector(".popup-model-check").textContent = selected ? "✓" : "";
  });
  closePopupModelPicker();
  showStatus(`Using ${splitModelName(value).name}.`, "ready");
}

function splitModelName(value) {
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1) return { name: value, provider: "" };
  return {
    name: value.slice(separator + 1),
    provider: value.slice(0, separator)
  };
}

function updateArticleState(status) {
  const normalized = ["running", "translated", "error"].includes(status) ? status : "idle";
  currentArticleStatus = normalized;
  const running = normalized === "running";
  const translated = normalized === "translated";
  translateArticle.disabled = running || !providerReady;
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
  subtitleToggle.disabled = !providerReady;
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
