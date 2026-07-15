(function initializeSubtitleContentScript() {
const SUBTITLE_BATCH_CHARS = 9000;
const SUBTITLE_CAPTURE_MAX_CHARS = 2_000_000;
const SUBTITLE_MAX_CUES = 5000;
const SUBTITLE_CAPTURE_DEBOUNCE_MS = 500;
let subtitleEnabled = false;
let targetLanguage = "zh-CN";
let activeCues = [];
let translatedById = new Map();
let lastSubtitleKey = "";
let renderTimer = null;
let subtitleTranslationTimer = null;
let subtitleRunId = 0;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TRANSLY_ENABLE_SUBTITLES") {
    subtitleEnabled = true;
    targetLanguage = message.targetLanguage || "zh-CN";
    document.documentElement.dataset.translySubtitlesEnabled = "true";
    injectSubtitleHook();
    ensureCaptionWindow();
    if (activeCues.length) scheduleSubtitleTranslation(activeCues);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "TRANSLY_DISABLE_SUBTITLES") {
    disableSubtitles();
    sendResponse({ ok: true });
    return true;
  }
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (data?.source !== "transly-subtitle-captured") return;
  if (typeof data.body !== "string" || data.body.length > SUBTITLE_CAPTURE_MAX_CHARS) return;

  const cues = parseSubtitle(data.body, data.url).slice(0, SUBTITLE_MAX_CUES);
  if (!cues.length) return;

  const key = `${data.url}:${cues.length}:${cues[0]?.text}:${cues[cues.length - 1]?.text}`;
  if (key === lastSubtitleKey) return;
  lastSubtitleKey = key;
  activeCues = cues;
  translatedById = new Map();

  if (subtitleEnabled) {
    ensureCaptionWindow();
    scheduleSubtitleTranslation(cues);
  }
});

function injectSubtitleHook() {
  if (document.documentElement.dataset.translySubtitleHooked) return;
  document.documentElement.dataset.translySubtitleHooked = "true";
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/injected/subtitle-hook.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function scheduleSubtitleTranslation(cues) {
  const runId = ++subtitleRunId;
  clearTimeout(subtitleTranslationTimer);
  subtitleTranslationTimer = setTimeout(() => {
    translateCues(cues, runId).catch((error) => console.error("[transly] subtitle translation failed", error));
  }, SUBTITLE_CAPTURE_DEBOUNCE_MS);
}

async function translateCues(cues, runId) {
  const settings = await getSettings();
  const batches = chunkItems(cues, Number(settings.subtitleBatchChars || SUBTITLE_BATCH_CHARS));
  const context = buildSubtitleContext(cues);

  const results = await Promise.allSettled(batches.map(async (batch, index) => {
    if (runId !== subtitleRunId) return;
    const cacheKey = await sha256(`${location.href}\n${targetLanguage}\n${batch.map((x) => x.text).join("\n")}`);
    const response = await requestTranslation({
      mode: "subtitle",
      phase: "translate",
      batchIndex: index + 1,
      batchCount: batches.length,
      sourceBlockCount: cues.length,
      targetLanguage,
      url: location.href,
      title: document.title,
      context,
      cacheKey,
      items: batch.map(({ id, text }) => ({ id, text }))
    });

    if (runId !== subtitleRunId) return;
    for (const item of response.items || []) {
      if (item.id && item.translation) translatedById.set(item.id, compactText(item.translation));
    }
  }));
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

function parseSubtitle(body, url) {
  const text = String(body || "").trim();
  if (!text) return [];
  if (/aisubtitle\.hdslb\.com\/bfs/i.test(url)) return parseBilibiliSubtitle(text);
  if (/\/api\/timedtext/i.test(url) || /^<\?xml|<transcript/i.test(text)) return parseYouTubeTimedText(text);
  if (/WEBVTT|^\d+\s*\n\d\d:/i.test(text)) return parseVtt(text);
  return [];
}

function parseBilibiliSubtitle(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    const items = Array.isArray(data?.body) ? data.body : [];
    return items.map((item, index) => {
      const start = Number(item.from ?? item.start ?? 0);
      const end = Number(item.to ?? item.end ?? start + 2.5);
      return {
        id: `cue-${index + 1}`,
        start,
        end,
        text: compactText(item.content || item.text || "")
      };
    }).filter((cue) => cue.text);
  } catch {
    return [];
  }
}

function parseYouTubeTimedText(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const nodes = [...doc.querySelectorAll("text")];
  return nodes.map((node, index) => {
    const start = Number(node.getAttribute("start") || 0);
    const dur = Number(node.getAttribute("dur") || 2.5);
    return {
      id: `cue-${index + 1}`,
      start,
      end: start + dur,
      text: compactText(node.textContent)
    };
  }).filter((cue) => cue.text);
}

function parseVtt(vttText) {
  const blocks = vttText.replace(/\r/g, "").split(/\n\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const text = compactText(lines.slice(timingIndex + 1).join(" "));
    if (!text) continue;
    cues.push({
      id: `cue-${cues.length + 1}`,
      start: parseTime(startRaw),
      end: parseTime(endRaw),
      text
    });
  }

  return cues;
}

function parseTime(value) {
  const parts = String(value || "0").split(":");
  const seconds = Number(parts.pop() || 0);
  const minutes = Number(parts.pop() || 0);
  const hours = Number(parts.pop() || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function ensureCaptionWindow() {
  if (!document.querySelector("#transly-caption-window")) {
    const node = document.createElement("div");
    node.id = "transly-caption-window";
    node.innerHTML = "<div class=\"transly-caption-original\"></div><div class=\"transly-caption-translation\"></div>";
    document.documentElement.appendChild(node);
  }
  if (!renderTimer) renderTimer = setInterval(renderCaption, 200);
}

function disableSubtitles() {
  subtitleEnabled = false;
  subtitleRunId++;
  document.documentElement.dataset.translySubtitlesEnabled = "false";
  clearTimeout(subtitleTranslationTimer);
  subtitleTranslationTimer = null;
  clearInterval(renderTimer);
  renderTimer = null;
  document.querySelector("#transly-caption-window")?.remove();
}

function renderCaption() {
  const video = document.querySelector("video");
  const windowEl = document.querySelector("#transly-caption-window");
  if (!video || !windowEl || !activeCues.length) return;

  const now = video.currentTime || 0;
  const cue = activeCues.find((item) => now >= item.start && now <= item.end);
  if (!cue) {
    windowEl.style.display = "none";
    return;
  }

  windowEl.style.display = "block";
  windowEl.querySelector(".transly-caption-original").textContent = cue.text;
  windowEl.querySelector(".transly-caption-translation").textContent = translatedById.get(cue.id) || "";
}

function buildSubtitleContext(cues) {
  const sample = cues.map((cue) => cue.text).join("\n").slice(0, 18000);
  return [
    document.title,
    sample
  ].filter(Boolean).join("\n\n");
}

function requestTranslation(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "TRANSLY_TRANSLATE", payload }, (response) => {
      if (response?.ok) resolve(response.data);
      else reject(new Error(response?.error || "Translation failed"));
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
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function chunkItems(items, maxChars) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const item of items) {
    const itemSize = item.text.length + 64;
    if (current.length && size + itemSize > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
})();
