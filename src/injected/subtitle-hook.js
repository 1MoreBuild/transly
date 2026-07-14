(() => {
  const EVENT = "transly-subtitle-captured";
  const seen = new Set();

  function isSubtitleUrl(url) {
    if (!url) return false;
    return /\/api\/timedtext|aisubtitle\.hdslb\.com\/bfs|\.vtt(?:$|[?#])|\.webvtt(?:$|[?#])/i.test(String(url));
  }

  function emit(url, body, kind) {
    if (!url || !body) return;
    const key = `${url}:${String(body).length}`;
    if (seen.has(key)) return;
    seen.add(key);
    window.postMessage({ source: EVENT, url, body: String(body), kind }, "*");
  }

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input?.url || input?.href;
      if (isSubtitleUrl(url)) {
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
        if (this.status >= 200 && this.status < 300 && isSubtitleUrl(this.__ictUrl)) {
          emit(this.__ictUrl, this.responseText, "xhr");
        }
      } catch {}
    });
    return originalSend.apply(this, arguments);
  };
})();
