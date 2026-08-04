(() => {
  if (window.__translySubtitleHookInstalled) return;
  window.__translySubtitleHookInstalled = true;
  const EVENT = "transly-subtitle-captured";
  const seen = new Set();

  function isSubtitleUrl(url) {
    if (!url) return false;
    return /\/api\/timedtext|aisubtitle\.hdslb\.com\/bfs|\.(?:vtt|webvtt|srt)(?:$|[?#])/i.test(String(url));
  }

  function emit(url, body, kind) {
    if (!url || !body) return;
    const content = String(body);
    const key = `${url}:${content.length}:${content.slice(0, 120)}`;
    if (seen.has(key)) return;
    seen.add(key);
    window.postMessage({ source: EVENT, url, body: content, kind }, "*");
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input?.url || input?.href;
      if (isSubtitleUrl(url) || /(?:text\/vtt|application\/x-subrip)/i.test(response.headers.get("content-type") || "")) {
        response.clone().text().then((body) => emit(url, body, "fetch")).catch(() => {});
      }
    } catch {}
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__ictUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend() {
    this.addEventListener("load", function onLoad() {
      try {
        const contentType = this.getResponseHeader?.("content-type") || "";
        if (this.status >= 200 && this.status < 300 && (isSubtitleUrl(this.__ictUrl) || /(?:text\/vtt|application\/x-subrip)/i.test(contentType))) {
          emit(this.__ictUrl, this.responseText, "xhr");
        }
      } catch {}
    });
    return originalSend.apply(this, arguments);
  };
})();
