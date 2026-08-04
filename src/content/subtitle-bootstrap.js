(function initializeSubtitleCaptureBootstrap(global) {
  const EVENT = "transly-subtitle-captured";
  const MAX_CAPTURES = 12;
  const MAX_CAPTURE_CHARS = 2_000_000;
  const state = global.TranslySubtitleCapture || {
    captures: [],
    listeners: new Set()
  };

  global.TranslySubtitleCapture = state;
  if (!state.listening) {
    state.listening = true;
    global.addEventListener("message", (event) => {
      if (event.source !== global || event.data?.source !== EVENT) return;
      const capture = event.data;
      if (typeof capture.body !== "string" || capture.body.length > MAX_CAPTURE_CHARS) return;
      state.captures.push(capture);
      if (state.captures.length > MAX_CAPTURES) state.captures.shift();
      for (const listener of state.listeners) listener(capture);
    });
  }

  if (document.documentElement?.dataset.translySubtitleHooked) return;
  const inject = () => {
    if (!document.documentElement || document.documentElement.dataset.translySubtitleHooked) return false;
    document.documentElement.dataset.translySubtitleHooked = "true";
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/injected/subtitle-hook.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    return true;
  };
  if (!inject()) {
    const observer = new MutationObserver(() => {
      if (inject()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }
})(globalThis);
