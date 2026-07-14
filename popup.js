const targetLanguage = document.querySelector("#targetLanguage");
const statusEl = document.querySelector("#status");
const popupParams = new URLSearchParams(location.search);
const sourceTabId = Number(popupParams.get("tabId") || 0);

chrome.runtime.sendMessage({ type: "TRANSLY_NATIVE_HEALTH" }, (response) => {
  if (chrome.runtime.lastError) {
    showStatus(chrome.runtime.lastError.message, "error");
    return;
  }
  if (response?.ok) {
    showStatus(`Native Host ready · ${response.data.model}`, "ready");
  } else {
    showStatus(response?.error || "Native Host unavailable.", "error");
  }
});

chrome.runtime.sendMessage({ type: "TRANSLY_GET_SETTINGS" }, (response) => {
  if (response?.ok) targetLanguage.value = response.data.targetLanguage || "zh-CN";
});

targetLanguage.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: "TRANSLY_SAVE_SETTINGS",
    payload: { targetLanguage: targetLanguage.value.trim() || "zh-CN" }
  });
});

document.querySelector("#translateArticle").addEventListener("click", async () => {
  runPopupAction("Starting article translation...", {
    type: "TRANSLY_TRANSLATE_ARTICLE",
    targetLanguage: targetLanguage.value.trim() || "zh-CN"
  });
});

document.querySelector("#clearArticle").addEventListener("click", async () => {
  runPopupAction("Clearing article translations...", { type: "TRANSLY_CLEAR_ARTICLE" });
});

document.querySelector("#enableSubtitles").addEventListener("click", async () => {
  runPopupAction("Enabling subtitle overlay...", {
    type: "TRANSLY_ENABLE_SUBTITLES",
    targetLanguage: targetLanguage.value.trim() || "zh-CN"
  });
});

async function runPopupAction(status, message) {
  showStatus(status);
  try {
    const response = await sendToActiveTab(message);
    if (response?.ok === false) throw new Error(response.error || "Action failed");
    window.close();
  } catch (error) {
    showStatus(String(error?.message || error), "error");
  }
}

function showStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

async function sendToActiveTab(message) {
  if (sourceTabId) return chrome.tabs.sendMessage(sourceTabId, message);
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }
  if (!tab?.id) throw new Error("No active tab.");
  return chrome.tabs.sendMessage(tab.id, message);
}
