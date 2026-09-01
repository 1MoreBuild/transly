(function initializeSelectionTranslation() {
  if (window.__translySelectionTranslationInstalled) return;
  window.__translySelectionTranslationInstalled = true;

  const MAX_SELECTION_CHARS = 5_000;
  const MAX_CONTEXT_CHARS = 1_800;
  const BLOCK_SELECTOR = "p,li,blockquote,figcaption,td,th,h1,h2,h3,h4,h5,h6,article,main,section,div";
  let snapshot = null;
  let host = null;
  let shadow = null;
  let trigger = null;
  let panel = null;
  let selectionTranslationEnabled = true;
  let selectionIconEnabled = false;
  let selectionShortcutStyle = "dot";

  document.addEventListener("pointerdown", (event) => {
    if (event.composedPath().includes(host)) return;
    hideTrigger();
  }, true);
  document.addEventListener("pointerup", () => setTimeout(refreshSelection, 0), true);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Shift" || event.shiftKey) setTimeout(refreshSelection, 0);
  }, true);
  window.addEventListener("scroll", hideTrigger, true);

  void loadSelectionIconPreference();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (changes.selectionTranslationEnabled) {
      selectionTranslationEnabled = changes.selectionTranslationEnabled.newValue !== false;
    }
    if (changes.selectionIconEnabled) {
      selectionIconEnabled = changes.selectionIconEnabled.newValue !== false;
    }
    if (changes.selectionShortcutStyle) {
      selectionShortcutStyle = normalizeShortcutStyle(changes.selectionShortcutStyle.newValue);
    }
    if (!changes.selectionTranslationEnabled && !changes.selectionIconEnabled && !changes.selectionShortcutStyle) return;
    if (selectionTranslationEnabled && selectionIconEnabled) refreshSelection();
    else hideSelectionUi();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TRANSLY_GET_SELECTION_STATE") {
      if (!selectionTranslationEnabled) {
        sendResponse({ ok: true, data: { available: false, disabled: true, textChars: 0, preview: "" } });
        return false;
      }
      const current = readSelection();
      if (current) snapshot = current;
      sendResponse({
        ok: true,
        data: {
          available: Boolean(current || snapshot?.text),
          textChars: (current || snapshot)?.text?.length || 0,
          preview: String((current || snapshot)?.text || "").slice(0, 120)
        }
      });
      return false;
    }

    if (message?.type === "TRANSLY_TRANSLATE_SELECTION") {
      if (!selectionTranslationEnabled) {
        sendResponse({ ok: false, error: localizedText("disabled") });
        return false;
      }
      const current = readSelection();
      const suppliedText = normalizeText(message.selectionText);
      const target = current || (snapshot?.text === suppliedText ? snapshot : null) || (suppliedText
        ? { text: suppliedText, context: "", rect: fallbackRect() }
        : snapshot);
      if (!target?.text) {
        sendResponse({ ok: false, error: localizedText("selectFirst") });
        return false;
      }
      if (target.text.length > MAX_SELECTION_CHARS) {
        sendResponse({ ok: false, error: localizedText("tooLong") });
        return false;
      }
      snapshot = target;
      sendResponse({ ok: true, data: { status: "started" } });
      void translateSelection(target, message.targetLanguage).catch((error) => {
        renderPanel({ state: "error", text: readableError(error), rect: target.rect });
      });
      return false;
    }

    return false;
  });

  function refreshSelection() {
    if (!selectionTranslationEnabled) {
      hideSelectionUi();
      return;
    }
    const current = readSelection();
    if (!current || current.text.length > MAX_SELECTION_CHARS) {
      hideTrigger();
      return;
    }
    snapshot = current;
    if (selectionIconEnabled) showTrigger(current.endpointRect || current.rect);
    else hideTrigger();
  }

  async function loadSelectionIconPreference() {
    const response = await runtimeMessage({ type: "TRANSLY_GET_SETTINGS" });
    selectionTranslationEnabled = response?.ok
      ? response.data?.selectionTranslationEnabled !== false
      : true;
    selectionIconEnabled = response?.ok ? response.data?.selectionIconEnabled !== false : true;
    selectionShortcutStyle = normalizeShortcutStyle(response?.data?.selectionShortcutStyle);
    if (selectionTranslationEnabled && selectionIconEnabled) refreshSelection();
  }

  function readSelection() {
    const selection = window.getSelection?.();
    const text = normalizeText(selection?.toString());
    if (!selection?.rangeCount || !text) return null;
    const range = selection.getRangeAt(0);
    const rect = normalizeRect(range.getBoundingClientRect());
    const endpointRect = selectionEndpointRect(selection, range);
    const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (!(node instanceof Element) || node.closest("[data-transly-selection-ui]")) return null;
    return {
      text,
      context: surroundingContext(node, text),
      rect,
      endpointRect
    };
  }

  function surroundingContext(node, text) {
    let block = node.closest(BLOCK_SELECTOR);
    let context = normalizeText(block?.innerText || block?.textContent);
    if (context.length < Math.min(240, text.length + 80)) {
      block = block?.parentElement?.closest(BLOCK_SELECTOR) || block;
      context = normalizeText(block?.innerText || block?.textContent);
    }
    if (!context) return "";
    if (context.length <= MAX_CONTEXT_CHARS) return context;
    const index = Math.max(0, context.indexOf(text));
    const start = Math.max(0, index - Math.floor((MAX_CONTEXT_CHARS - text.length) / 2));
    return context.slice(start, start + MAX_CONTEXT_CHARS).trim();
  }

  async function translateSelection(target, explicitTargetLanguage) {
    if (!selectionTranslationEnabled) return;
    hideTrigger();
    renderPanel({ state: "loading", text: localizedText("translating"), rect: target.rect });
    const settingsResponse = await runtimeMessage({ type: "TRANSLY_GET_SETTINGS" });
    if (!settingsResponse?.ok) throw new Error(settingsResponse?.error || localizedText("failed"));
    const targetLanguage = String(explicitTargetLanguage || settingsResponse.data?.targetLanguage || "zh-CN");
    const cacheKey = await selectionCacheKey(target, targetLanguage);
    const response = await runtimeMessage({
      type: "TRANSLY_TRANSLATE",
      payload: {
        mode: "selection",
        targetLanguage,
        context: target.context,
        cacheKey,
        items: [{ id: "selection", text: target.text }]
      }
    });
    if (!selectionTranslationEnabled) return;
    if (!response?.ok) throw new Error(response?.error || localizedText("failed"));
    const translation = String(response.data?.items?.[0]?.translation || "").trim();
    if (!translation) throw new Error(localizedText("failed"));
    renderPanel({ state: "result", text: translation, rect: target.rect });
  }

  function showTrigger(rect) {
    if (!selectionTranslationEnabled || !selectionIconEnabled) {
      hideTrigger();
      return;
    }
    ensureUi();
    panel.hidden = true;
    trigger.dataset.style = selectionShortcutStyle;
    trigger.hidden = false;
    const size = selectionShortcutStyle === "icon" ? 28 : 22;
    const left = clamp(rect.right - size / 2, 3, window.innerWidth - size - 3);
    const top = clamp(rect.bottom - size / 2 + 4, 3, window.innerHeight - size - 3);
    trigger.style.left = `${left}px`;
    trigger.style.top = `${top}px`;
  }

  function hideTrigger() {
    if (trigger) trigger.hidden = true;
  }

  function hideSelectionUi() {
    snapshot = null;
    hideTrigger();
    if (panel) panel.hidden = true;
  }

  function renderPanel({ state, text, rect }) {
    ensureUi();
    trigger.hidden = true;
    panel.hidden = false;
    panel.dataset.state = state;
    panel.querySelector("[data-role='title']").textContent = state === "error"
      ? localizedText("errorTitle")
      : localizedText("title");
    panel.querySelector("[data-role='body']").textContent = text;
    const copyButton = panel.querySelector("[data-role='copy']");
    copyButton.hidden = state !== "result";
    copyButton.dataset.value = state === "result" ? text : "";
    positionPanel(rect || fallbackRect());
  }

  function positionPanel(rect) {
    const width = Math.min(340, window.innerWidth - 16);
    panel.style.width = `${width}px`;
    panel.style.left = `${clamp(rect.left, 8, window.innerWidth - width - 8)}px`;
    panel.style.top = `${clamp(rect.bottom + 10, 8, window.innerHeight - panel.offsetHeight - 8)}px`;
    requestAnimationFrame(() => {
      const below = rect.bottom + 10;
      const top = below + panel.offsetHeight <= window.innerHeight - 8
        ? below
        : rect.top - panel.offsetHeight - 10;
      panel.style.top = `${clamp(top, 8, window.innerHeight - panel.offsetHeight - 8)}px`;
    });
  }

  function ensureUi() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.dataset.translySelectionUi = "true";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host{all:initial}*{box-sizing:border-box}button{font:inherit}
        .trigger{position:fixed;display:grid;width:22px;height:22px;place-items:center;padding:0;border:0;background:transparent;cursor:pointer;pointer-events:auto}
        .trigger::before{content:"";display:block;width:10px;height:10px;border:2px solid #fff;border-radius:50%;background:#ffc41a;transition:transform 100ms ease}
        .trigger:hover::before,.trigger:focus-visible::before{transform:scale(1.18)}
        .trigger img{display:none;width:24px;height:24px}
        .trigger[data-style=icon]{width:28px;height:28px}
        .trigger[data-style=icon]::before{display:none}
        .trigger[data-style=icon] img{display:block}
        .trigger:focus-visible,.icon:focus-visible{outline:2px solid #20201e;outline-offset:2px}
        .panel{position:fixed;padding:12px;border:1px solid rgba(32,32,30,.14);border-radius:10px;background:#fff;color:#20201e;box-shadow:0 18px 48px rgba(0,0,0,.2),0 4px 12px rgba(0,0,0,.08);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:auto}
        .panel[data-state=error]{border-color:rgba(198,53,43,.34)}
        .head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px}
        .title{font-size:11px;font-weight:700;color:#6f6d67;text-transform:uppercase;letter-spacing:.04em}
        .actions{display:flex;align-items:center;gap:2px}.icon{display:grid;width:28px;height:28px;place-items:center;padding:0;border:0;border-radius:6px;background:transparent;color:#6f6d67;cursor:pointer}.icon:hover{background:#f3f2ef;color:#20201e}
        .body{max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.55}
        .panel[data-state=loading] .body{color:#6f6d67}.panel[data-state=error] .body{color:#a52d25}
        [hidden]{display:none!important}@media(prefers-reduced-motion:reduce){.trigger::before{transition:none}}
      </style>
      <button class="trigger" data-style="dot" type="button" title="${escapeAttribute(localizedText("action"))}" aria-label="${escapeAttribute(localizedText("action"))}" hidden>
        <img src="${chrome.runtime.getURL("assets/icons/transly-player.svg")}" alt="">
      </button>
      <section class="panel" role="dialog" aria-live="polite" hidden>
        <div class="head">
          <span class="title" data-role="title"></span>
          <div class="actions">
            <button class="icon" data-role="copy" type="button" title="${escapeAttribute(localizedText("copy"))}" aria-label="${escapeAttribute(localizedText("copy"))}">${escapeHtml(localizedText("copy"))}</button>
            <button class="icon" data-role="close" type="button" title="${escapeAttribute(localizedText("close"))}" aria-label="${escapeAttribute(localizedText("close"))}">×</button>
          </div>
        </div>
        <div class="body" data-role="body"></div>
      </section>`;
    trigger = shadow.querySelector(".trigger");
    panel = shadow.querySelector(".panel");
    const openSelectionTranslation = () => {
      if (snapshot) void translateSelection(snapshot).catch((error) => {
        renderPanel({ state: "error", text: readableError(error), rect: snapshot.rect });
      });
    };
    trigger.addEventListener("pointerenter", openSelectionTranslation);
    trigger.addEventListener("click", openSelectionTranslation);
    panel.querySelector("[data-role='close']").addEventListener("click", () => { panel.hidden = true; });
    panel.querySelector("[data-role='copy']").addEventListener("click", async (event) => {
      const value = event.currentTarget.dataset.value || "";
      if (!value) return;
      await copyText(value);
      event.currentTarget.textContent = localizedText("copied");
      setTimeout(() => { event.currentTarget.textContent = localizedText("copy"); }, 1_200);
    });
    (document.documentElement || document.body).append(host);
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(response || { ok: false, error: localizedText("failed") });
      });
    });
  }

  async function selectionCacheKey(target, targetLanguage) {
    const value = `selection:v1:${targetLanguage}:${target.text}:${target.context}`;
    if (!crypto?.subtle) return value;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return `selection:v1:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function localizedText(key) {
    const isChinese = (navigator.language || "").toLowerCase().startsWith("zh");
    const copy = isChinese ? {
      action: "翻译所选文本", title: "译文", translating: "翻译中…", failed: "翻译失败",
      errorTitle: "无法翻译", selectFirst: "请先选择文本。", tooLong: "所选文本过长。", disabled: "划词翻译已关闭。", copy: "复制", copied: "已复制", close: "关闭"
    } : {
      action: "Translate selection", title: "Translation", translating: "Translating…", failed: "Translation failed",
      errorTitle: "Could not translate", selectFirst: "Select text first.", tooLong: "The selection is too long.", disabled: "Selection translation is turned off.", copy: "Copy", copied: "Copied", close: "Close"
    };
    return copy[key] || "";
  }

  function readableError(error) {
    const value = String(error?.message || error || localizedText("failed"));
    return value.replace(/^\[[A-Z0-9_]+]\s*/, "");
  }

  function normalizeText(value) {
    return String(value || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function normalizeRect(rect) {
    if (rect && (rect.width || rect.height)) return rect;
    return fallbackRect();
  }

  function selectionEndpointRect(selection, range) {
    if (selection.focusNode) {
      try {
        const caret = document.createRange();
        caret.setStart(selection.focusNode, selection.focusOffset);
        caret.collapse(true);
        const caretRect = caret.getClientRects()[0] || caret.getBoundingClientRect();
        if (caretRect && caretRect.height) return caretRect;
      } catch {}
    }
    const rects = [...range.getClientRects()].filter((rect) => rect.width || rect.height);
    if (!rects.length) return normalizeRect(range.getBoundingClientRect());
    const focusAtStart = selection.focusNode === range.startContainer
      && selection.focusOffset === range.startOffset;
    const rect = focusAtStart ? rects[0] : rects.at(-1);
    const x = focusAtStart ? rect.left : rect.right;
    return { left: x, right: x, top: rect.top, bottom: rect.bottom, width: 0, height: rect.height };
  }

  function normalizeShortcutStyle(value) {
    return value === "icon" ? "icon" : "dot";
  }

  function fallbackRect() {
    return { left: Math.max(8, window.innerWidth / 2 - 170), right: window.innerWidth / 2, top: 72, bottom: 72, width: 0, height: 0 };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(Math.max(min, max), Number(value) || min));
  }

  function escapeAttribute(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  }

  function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }
})();
