const NATIVE_HOST_NAME = "com.1morebuild.transly";
const NATIVE_PROTOCOL_VERSION = 1;
const NATIVE_IDLE_TIMEOUT_MS = 60_000;
const MAX_NATIVE_PAYLOAD_CHARS = 1_800_000;

let nativePort = null;
let idleTimer = null;
const pendingRequests = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (message?.type === "TRANSLY_NATIVE_HEALTH") {
    if (!sender.url?.startsWith(chrome.runtime.getURL("popup.html"))) return false;
    postNativeRequest("health")
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: formatNativeError(error) }));
    return true;
  }

  if (message?.type === "TRANSLY_TRANSLATE") {
    postNativeRequest("translate", message.payload, {
      onProgress(data) {
        relayTranslationProgress(sender, data);
      }
    })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: formatNativeError(error) }));
    return true;
  }

  if (message?.type === "TRANSLY_AUDIT_ARTICLE") {
    postNativeRequest("audit", message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: formatNativeError(error) }));
    return true;
  }

  if (message?.type === "TRANSLY_GET_SETTINGS") {
    chrome.storage.sync.get(
      {
        targetLanguage: "zh-CN",
        articleDisplayMode: "bilingual",
        articleBatchChars: 28000,
        articleBatchMaxItems: 28,
        articleContextChars: 36000,
        enableArticleAuditLoop: true,
        articleAuditMaxBlocks: 60,
        articleAuditMaxRepairItems: 20,
        subtitleBatchChars: 9000
      },
      (settings) => sendResponse({ ok: true, data: settings })
    );
    return true;
  }

  if (message?.type === "TRANSLY_SAVE_SETTINGS") {
    chrome.storage.sync.set(message.payload || {}, () => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

function postNativeRequest(type, payload = {}, options = {}) {
  validateNativePayload(type, payload);
  const port = getNativePort();
  const id = crypto.randomUUID();
  clearTimeout(idleTimer);

  return new Promise((resolve, reject) => {
    const timeout = type === "health"
      ? setTimeout(() => {
          if (!pendingRequests.delete(id)) return;
          reject(nativeRequestError("NATIVE_REQUEST_TIMEOUT", "Native health check timed out."));
          scheduleNativePortClose();
        }, 15_000)
      : null;
    pendingRequests.set(id, { resolve, reject, timeout, onProgress: options.onProgress });
    try {
      port.postMessage({
        protocolVersion: NATIVE_PROTOCOL_VERSION,
        id,
        type,
        payload
      });
    } catch (error) {
      pendingRequests.delete(id);
      clearTimeout(timeout);
      reject(error);
      scheduleNativePortClose();
    }
  });
}

function validateNativePayload(type, payload) {
  if (type === "health") return;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw nativeRequestError("INVALID_PAYLOAD", "Native request payload must be an object.");
  }
  if (JSON.stringify(payload).length > MAX_NATIVE_PAYLOAD_CHARS) {
    throw nativeRequestError("PAYLOAD_TOO_LARGE", "Translation request is too large.");
  }

  if (type === "translate") {
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 250) {
      throw nativeRequestError("INVALID_ITEMS", "Translation request must contain 1 to 250 items.");
    }
    if (!["article", "subtitle"].includes(payload.mode)) {
      throw nativeRequestError("INVALID_MODE", "Unsupported translation mode.");
    }
    if (typeof payload.targetLanguage !== "string" || !payload.targetLanguage || payload.targetLanguage.length > 40) {
      throw nativeRequestError("INVALID_LANGUAGE", "Invalid target language.");
    }
    const ids = new Set();
    let textChars = 0;
    for (const item of payload.items) {
      if (!item || typeof item.id !== "string" || !item.id || item.id.length > 128 || ids.has(item.id)) {
        throw nativeRequestError("INVALID_ITEMS", "Translation item IDs must be unique strings.");
      }
      if (typeof item.text !== "string" || !item.text) {
        throw nativeRequestError("INVALID_ITEMS", "Translation item text must be non-empty.");
      }
      ids.add(item.id);
      textChars += item.text.length;
    }
    if (textChars > 1_500_000) {
      throw nativeRequestError("PAYLOAD_TOO_LARGE", "Translation text is too large.");
    }
    return;
  }

  if (type === "audit") {
    if (!Array.isArray(payload.blocks) || payload.blocks.length > 120) {
      throw nativeRequestError("INVALID_BLOCKS", "Audit request must contain at most 120 blocks.");
    }
    if (typeof payload.targetLanguage !== "string" || !payload.targetLanguage || payload.targetLanguage.length > 40) {
      throw nativeRequestError("INVALID_LANGUAGE", "Invalid target language.");
    }
    return;
  }

  throw nativeRequestError("UNSUPPORTED_REQUEST", `Unsupported native request type: ${type}`);
}

function nativeRequestError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getNativePort() {
  if (nativePort) return nativePort;

  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  nativePort = port;
  port.onMessage.addListener((message) => {
    if (message?.protocolVersion !== NATIVE_PROTOCOL_VERSION || typeof message.id !== "string") return;
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    if (message.progress) {
      try {
        pending.onProgress?.(message.data);
      } catch {
        // Progress is best effort; the validated final response remains authoritative.
      }
      return;
    }
    pendingRequests.delete(message.id);
    clearTimeout(pending.timeout);

    if (message.ok) {
      pending.resolve(message.data);
    } else {
      const error = new Error(message.error?.message || "Native host request failed.");
      error.code = message.error?.code || "NATIVE_HOST_ERROR";
      error.retryable = Boolean(message.error?.retryable);
      pending.reject(error);
    }
    scheduleNativePortClose();
  });

  port.onDisconnect.addListener(() => {
    const detail = chrome.runtime.lastError?.message || "Native host disconnected.";
    nativePort = null;
    clearTimeout(idleTimer);
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout);
      const error = new Error(detail);
      error.code = "NATIVE_HOST_DISCONNECTED";
      error.retryable = true;
      pending.reject(error);
    }
    pendingRequests.clear();
  });

  return port;
}

function relayTranslationProgress(sender, data) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || !data || typeof data !== "object") return;
  const message = { type: "TRANSLY_TRANSLATION_PROGRESS", data };
  const callback = () => void chrome.runtime.lastError;
  if (Number.isInteger(sender.frameId)) {
    chrome.tabs.sendMessage(tabId, message, { frameId: sender.frameId }, callback);
  } else {
    chrome.tabs.sendMessage(tabId, message, callback);
  }
}

function scheduleNativePortClose() {
  clearTimeout(idleTimer);
  if (!nativePort || pendingRequests.size) return;
  idleTimer = setTimeout(() => {
    if (!nativePort || pendingRequests.size) return;
    const port = nativePort;
    nativePort = null;
    port.disconnect();
  }, NATIVE_IDLE_TIMEOUT_MS);
}

function formatNativeError(error) {
  const code = error?.code ? `[${error.code}] ` : "";
  const hint = error?.code === "NATIVE_HOST_DISCONNECTED"
    ? " Run `npm run native:doctor` and `npm run native:install`."
    : "";
  return `${code}${String(error?.message || error)}${hint}`;
}
