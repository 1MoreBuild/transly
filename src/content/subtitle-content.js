(function initializeSubtitleContentScript(global) {
  const core = global.TranslySubtitleCore;
  if (!core) return;

  const SUBTITLE_MAX_CUES = 5000;
  const CAPTURE_DEBOUNCE_MS = 120;
  const NO_CAPTIONS_TIMEOUT_MS = 6000;
  const DEFAULT_APPEARANCE = Object.freeze({
    subtitleDisplayMode: "bilingual",
    subtitleLanguageOrder: "source-first",
    subtitleSourceFontSizePx: 25,
    subtitleTranslationFontSizePx: 30,
    subtitlePositionPercent: 6,
    subtitleBackgroundOpacity: 0.76
  });
  const trackedVideos = new Map();
  const sourceCueSets = new Map();
  const translatedById = new Map();
  const pendingCueIds = new Set();
  const progressRequestRuns = new Map();
  const captureState = global.TranslySubtitleCapture;
  let subtitleEnabled = false;
  let targetLanguage = "zh-CN";
  let activeCues = [];
  let activeSourceKey = "";
  let translationTimer = null;
  let noCaptionsTimer = null;
  let renderFrame = 0;
  let controlsPositionFrame = 0;
  let translationRunning = false;
  let translationQueued = false;
  let subtitleRunId = 0;
  let subtitleStatus = "off";
  let subtitleError = "";
  let videoSequence = 0;
  let observedUrl = location.href;
  let appearance = { ...DEFAULT_APPEARANCE };
  let playerControlsHost = null;
  let playerControlsShadow = null;
  let playerControlsVideo = null;
  let playerPanelOpen = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TRANSLY_TRANSLATION_PROGRESS" && message.data?.mode === "subtitle") {
      renderSubtitleTranslationProgress(message.data);
      return false;
    }

    if (message?.type === "TRANSLY_ENABLE_SUBTITLES") {
      enableSubtitles(message.targetLanguage || targetLanguage)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }

    if (message?.type === "TRANSLY_DISABLE_SUBTITLES") {
      disableSubtitles();
      sendResponse({ ok: true, data: subtitleState() });
      return true;
    }

    if (message?.type === "TRANSLY_GET_SUBTITLE_STATE") {
      sendResponse({ ok: true, data: subtitleState() });
      return true;
    }
    return false;
  });

  if (captureState) {
    captureState.listeners.add(handleCapture);
    for (const capture of captureState.captures) handleCapture(capture);
  }

  observeVideos();
  getSettings().then((settings) => {
    targetLanguage = settings.targetLanguage || targetLanguage;
    applyAppearanceSettings(settings);
    if (settings.subtitleEnabled) enableSubtitles(targetLanguage).catch(() => {});
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    const nextSettings = Object.fromEntries(
      Object.entries(changes).map(([key, change]) => [key, change.newValue])
    );
    applyAppearanceSettings(nextSettings);
    if (changes.targetLanguage?.newValue) targetLanguage = changes.targetLanguage.newValue;
    if (!changes.subtitleEnabled) return;
    if (changes.subtitleEnabled.newValue) enableSubtitles(targetLanguage).catch((error) => {
      setSubtitleStatus("error", error);
    });
    else disableSubtitles();
  });

  async function enableSubtitles(language) {
    const languageChanged = targetLanguage !== language;
    targetLanguage = language;
    subtitleEnabled = true;
    if (languageChanged) {
      translatedById.clear();
      pendingCueIds.clear();
      subtitleRunId++;
    }
    setSubtitleStatus(activeCues.length ? "translating" : "detecting");
    ensureCaptionWindow();
    scanVideos();
    activateTextTrackCandidate();
    triggerSiteCaptions();
    chooseBestSource();
    if (activeCues.length) scheduleTranslation();
    else armNoCaptionsTimeout();
    return subtitleState();
  }

  function disableSubtitles() {
    subtitleEnabled = false;
    subtitleRunId++;
    translationQueued = false;
    clearTimeout(translationTimer);
    clearTimeout(noCaptionsTimer);
    translationTimer = null;
    noCaptionsTimer = null;
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    restoreTextTracks();
    document.documentElement.dataset.translySubtitlesRendering = "false";
    document.querySelector("#transly-caption-window")?.remove();
    setSubtitleStatus("off");
  }

  function handleCapture(capture) {
    if (!capture || typeof capture.body !== "string") return;
    const language = core.subtitleLanguageFromUrl(capture.url);
    if (core.sameLanguage(language, targetLanguage)) return;
    const cues = core.parseSubtitle(capture.body, capture.url).slice(0, SUBTITLE_MAX_CUES);
    if (!cues.length) return;
    const key = `network:${capture.url}`;
    sourceCueSets.set(key, {
      key,
      type: "network",
      cues,
      language,
      updatedAt: Date.now()
    });
    chooseBestSource(key);
  }

  function observeVideos() {
    scanVideos();
    const observer = new MutationObserver(() => scanVideos());
    observer.observe(document, { childList: true, subtree: true });
    global.addEventListener("resize", schedulePlayerControlsPosition, { passive: true });
    global.addEventListener("scroll", schedulePlayerControlsPosition, { passive: true, capture: true });
  }

  function scanVideos() {
    if (observedUrl !== location.href) resetForNavigation();
    pruneDisconnectedVideos();
    for (const video of document.querySelectorAll("video")) trackVideo(video);
    ensurePlayerControls();
  }

  function trackVideo(video) {
    if (trackedVideos.has(video)) {
      scanTextTracks(video);
      return;
    }
    const record = {
      id: `video-${++videoSequence}`,
      tracks: new Map(),
      remove: []
    };
    trackedVideos.set(video, record);
    const refresh = () => scanTextTracks(video);
    video.textTracks?.addEventListener?.("addtrack", refresh);
    record.remove.push(() => video.textTracks?.removeEventListener?.("addtrack", refresh));
    scanTextTracks(video);
  }

  function scanTextTracks(video) {
    const record = trackedVideos.get(video);
    if (!record?.tracks || !video.textTracks) return;
    for (const track of [...video.textTracks]) {
      if (record.tracks.has(track)) {
        ingestTextTrack(video, track);
        continue;
      }
      const trackRecord = {
        key: `texttrack:${record.id}:${track.language || "unknown"}:${track.label || track.kind || "track"}`,
        restoreMode: null,
        listener: () => ingestTextTrack(video, track)
      };
      record.tracks.set(track, trackRecord);
      track.addEventListener?.("cuechange", trackRecord.listener);
      ingestTextTrack(video, track);
    }
  }

  function pruneDisconnectedVideos() {
    for (const [video, record] of trackedVideos) {
      if (video.isConnected) continue;
      for (const remove of record.remove) remove();
      for (const [track, trackRecord] of record.tracks) {
        track.removeEventListener?.("cuechange", trackRecord.listener);
        sourceCueSets.delete(trackRecord.key);
      }
      trackedVideos.delete(video);
    }
    if (playerControlsVideo && !playerControlsVideo.isConnected) playerControlsVideo = null;
  }

  function resetForNavigation() {
    observedUrl = location.href;
    subtitleRunId++;
    translatedById.clear();
    pendingCueIds.clear();
    sourceCueSets.clear();
    activeCues = [];
    activeSourceKey = "";
    restoreTextTracks();
    if (subtitleEnabled) {
      setSubtitleStatus("detecting");
      armNoCaptionsTimeout();
      setTimeout(() => {
        if (!subtitleEnabled) return;
        activateTextTrackCandidate();
        triggerSiteCaptions();
      }, 0);
    }
  }

  function ingestTextTrack(video, track) {
    const record = trackedVideos.get(video)?.tracks?.get(track);
    if (!record || core.sameLanguage(track.language, targetLanguage)) return;
    const cueList = [...(track.cues || [])];
    if (!cueList.length) return;
    const incoming = cueList.map((cue) => ({
      start: cue.startTime,
      end: cue.endTime,
      text: cue.text
    }));
    const previous = sourceCueSets.get(record.key)?.cues || [];
    const cues = core.mergeCues(previous, incoming, SUBTITLE_MAX_CUES);
    sourceCueSets.set(record.key, {
      key: record.key,
      type: "texttrack",
      cues,
      language: track.language || "",
      video,
      track,
      updatedAt: Date.now()
    });
    chooseBestSource(record.key);
  }

  function chooseBestSource(preferredKey = "") {
    if (!sourceCueSets.size) return;
    const currentVideo = chooseVideo();
    const candidates = [...sourceCueSets.values()].sort((left, right) => (
      sourceScore(right, currentVideo, preferredKey) - sourceScore(left, currentVideo, preferredKey)
    ));
    const best = candidates[0];
    if (!best?.cues?.length) return;
    activeSourceKey = best.key;
    activeCues = best.cues;
    clearTimeout(noCaptionsTimer);
    if (subtitleEnabled) {
      setSubtitleStatus(hasAnyTranslation() ? "ready" : "translating");
      scheduleTranslation();
    }
  }

  function sourceScore(source, currentVideo, preferredKey) {
    const videoBonus = source.video && source.video === currentVideo ? 1_000_000 : 0;
    const preferredBonus = source.key === preferredKey ? 100_000 : 0;
    const textTrackBonus = source.type === "texttrack" ? 10_000 : 0;
    return videoBonus + preferredBonus + textTrackBonus + Math.min(source.cues.length, 9000);
  }

  function scheduleTranslation() {
    if (!subtitleEnabled || !activeCues.length) return;
    clearTimeout(translationTimer);
    translationTimer = setTimeout(() => {
      translationTimer = null;
      translateMissingCues().catch((error) => {
        setSubtitleStatus("error", error);
      });
    }, CAPTURE_DEBOUNCE_MS);
  }

  async function translateMissingCues() {
    if (translationRunning) {
      translationQueued = true;
      return;
    }
    const groups = core.groupCuesByMeaning(activeCues);
    const missingGroups = groups.filter((group) => (
      group.cues.some((cue) => !translatedById.has(cue.id))
      && group.cues.every((cue) => !pendingCueIds.has(cue.id))
    ));
    if (!missingGroups.length) {
      if (hasAnyTranslation()) setSubtitleStatus("ready");
      return;
    }

    translationRunning = true;
    translationQueued = false;
    const runId = subtitleRunId;
    const sourceKey = activeSourceKey;
    const requestedCues = missingGroups.flatMap((group) => group.cues);
    for (const cue of requestedCues) pendingCueIds.add(cue.id);

    try {
      const settings = await getSettings();
      const video = chooseVideo();
      const prioritized = core.prioritizeCueGroups(missingGroups, video?.currentTime || 0);
      const batches = core.chunkCueGroups(prioritized, {
        maxChars: Number(settings.subtitleBatchChars || 1200),
        maxItems: Number(settings.subtitleBatchMaxItems || 12)
      });
      setSubtitleStatus("translating");

      const results = await Promise.allSettled(batches.map(async (batch, index) => {
        const clientRequestId = `subtitle-${crypto.randomUUID()}`;
        progressRequestRuns.set(clientRequestId, runId);
        try {
          const cacheKey = await sha256(`${sourceKey}\n${targetLanguage}\n${batch.map((cue) => `${cue.subtitleGroup}:${cue.text}`).join("\n")}`);
          const response = await requestTranslation({
            mode: "subtitle",
            phase: "translate",
            clientRequestId,
            batchIndex: index + 1,
            batchCount: batches.length,
            sourceBlockCount: activeCues.length,
            targetLanguage,
            url: location.href,
            title: document.title,
            context: buildSubtitleContext(activeCues, batch),
            cacheKey,
            items: batch.map(({ id, text, subtitleGroup }) => ({ id, text, subtitleGroup }))
          });
          if (runId !== subtitleRunId) return;
          applyTranslations(response.items);
        } finally {
          progressRequestRuns.delete(clientRequestId);
        }
      }));

      const failures = results.filter((result) => result.status === "rejected");
      if (runId === subtitleRunId) {
        if (hasAnyTranslation()) setSubtitleStatus("ready", failures[0]?.reason || "");
        else if (failures.length) setSubtitleStatus("error", failures[0].reason);
      }
    } finally {
      for (const cue of requestedCues) pendingCueIds.delete(cue.id);
      translationRunning = false;
      if (translationQueued && subtitleEnabled) scheduleTranslation();
    }
  }

  function renderSubtitleTranslationProgress(data) {
    if (
      !subtitleEnabled
      || !Array.isArray(data?.items)
      || progressRequestRuns.get(data.clientRequestId) !== subtitleRunId
    ) return;
    applyTranslations(data.items);
    if (hasAnyTranslation()) setSubtitleStatus("ready");
  }

  function applyTranslations(items) {
    for (const item of items || []) {
      const translation = core.compactText(item?.translation);
      if (item?.id && translation) translatedById.set(item.id, translation);
    }
  }

  function ensureCaptionWindow() {
    let node = document.querySelector("#transly-caption-window");
    if (!node) {
      node = document.createElement("div");
      node.id = "transly-caption-window";
      node.className = "notranslate";
      node.setAttribute("translate", "no");
      node.innerHTML = "<div class=\"transly-caption-original\"></div><div class=\"transly-caption-translation\"></div>";
      document.documentElement.appendChild(node);
    }
    applyAppearanceToCaption(node);
    if (!renderFrame) renderLoop();
    return node;
  }

  function renderLoop() {
    renderCaption();
    positionPlayerControls();
    renderFrame = requestAnimationFrame(renderLoop);
  }

  function renderCaption() {
    const windowEl = document.querySelector("#transly-caption-window");
    const video = chooseVideo();
    if (!subtitleEnabled || !windowEl || !video || !activeCues.length) {
      hideCaption(windowEl);
      return;
    }
    const cue = core.activeCueAt(activeCues, video.currentTime || 0);
    const translation = cue ? translatedById.get(cue.id) : "";
    if (!cue || !translation) {
      hideCaption(windowEl);
      return;
    }

    const rect = video.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 80 || rect.bottom <= 0 || rect.top >= innerHeight) {
      hideCaption(windowEl);
      return;
    }
    const inset = subtitleBottomInset(video, rect);
    windowEl.style.display = "flex";
    windowEl.style.left = `${rect.left + rect.width / 2}px`;
    windowEl.style.bottom = `${Math.max(12, innerHeight - rect.bottom + inset)}px`;
    windowEl.style.maxWidth = `${Math.min(980, Math.max(240, rect.width * 0.9))}px`;
    windowEl.querySelector(".transly-caption-original").textContent = cue.text;
    windowEl.querySelector(".transly-caption-translation").textContent = translation;
    document.documentElement.dataset.translySubtitlesRendering = "true";
    hideSelectedTextTrack();
  }

  function ensurePlayerControls() {
    const video = chooseVideo();
    if (!video) return;
    playerControlsVideo = video;
    if (!playerControlsHost) createPlayerControls();

    if (playerControlsHost.parentElement !== document.documentElement) {
      document.documentElement.appendChild(playerControlsHost);
    }
    playerControlsHost.dataset.placement = "floating";
    updatePlayerControls();
    schedulePlayerControlsPosition();
  }

  function createPlayerControls() {
    playerControlsHost = document.createElement("div");
    playerControlsHost.id = "transly-subtitle-controls";
    playerControlsHost.className = "notranslate";
    playerControlsHost.setAttribute("translate", "no");
    playerControlsShadow = playerControlsHost.attachShadow({ mode: "open" });
    playerControlsShadow.innerHTML = `
      <style>
        :host { color-scheme: dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        :host([data-placement="floating"]) { position: fixed; z-index: 2147483646; display: flex; }
        .control {
          position: relative; display: flex; align-items: center; height: 48px;
          border-radius: 12px; background: rgba(18,18,20,.72);
          box-shadow: 0 4px 16px rgba(0,0,0,.28);
          -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); overflow: visible;
        }
        button { box-sizing: border-box; border: 0; color: rgba(255,255,255,.88); background: transparent; font: inherit; cursor: pointer; }
        button:hover { background: rgba(255,255,255,.1); }
        button:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
        .toggle {
          position: relative; display: grid; place-items: center;
          width: 48px; height: 48px; padding: 0; border-radius: 12px 0 0 12px;
        }
        .brand-icon { display: block; width: 24px; height: 24px; opacity: .82; }
        .status-dot { position: absolute; right: 7px; top: 7px; width: 5px; height: 5px; border-radius: 50%; background: transparent; }
        :host([data-state="detecting"]) .status-dot,
        :host([data-state="translating"]) .status-dot { background: #f5b800; animation: pulse 1s ease-in-out infinite; }
        :host([data-state="ready"]) .status-dot { background: #22c55e; }
        :host([data-state="error"]) .status-dot,
        :host([data-state="no-captions"]) .status-dot { background: #ef4444; }
        :host([data-enabled="true"]) .brand-icon { opacity: 1; }
        .appearance {
          width: 32px; height: 32px; margin-right: 4px; padding: 0;
          border-left: 1px solid rgba(255,255,255,.14); border-radius: 0 8px 8px 0; opacity: .72;
        }
        .appearance:hover { color: #fff; }
        .caret { display: inline-block; width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg); }
        .panel {
          position: absolute; right: 0; bottom: calc(100% + 8px); width: 320px; box-sizing: border-box;
          padding: 14px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px;
          background: rgba(20,20,22,.96); color: #fff; box-shadow: 0 16px 44px rgba(0,0,0,.42);
          -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
          max-height: var(--transly-panel-max-height, 420px); overflow-y: auto;
        }
        .panel[hidden] { display: none; }
        .panel-title { margin: 0 0 12px; font-size: 13px; font-weight: 650; letter-spacing: 0; }
        .segment { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2px; padding: 2px; border-radius: 7px; background: rgba(255,255,255,.08); }
        .segment.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .segment button { min-height: 30px; border-radius: 5px; font-size: 12px; }
        .segment button[aria-pressed="true"] { color: #111; background: #fff; }
        .order-setting { margin-top: 13px; }
        .order-setting[hidden] { display: none; }
        .setting-label { display: block; margin: 0 0 6px; color: rgba(255,255,255,.72); font-size: 11px; }
        .range-row { display: grid; grid-template-columns: 92px 1fr 35px; align-items: center; gap: 9px; margin-top: 13px; }
        .range-row label, output { color: rgba(255,255,255,.72); font-size: 11px; }
        output { text-align: right; font-variant-numeric: tabular-nums; }
        input[type="range"] { width: 100%; margin: 0; accent-color: #fff; }
        .error { margin: 11px 0 0; color: #fca5a5; font-size: 11px; line-height: 1.35; }
        .error:empty { display: none; }
        @keyframes pulse { 50% { opacity: .32; } }
      </style>
      <div class="control">
        <button class="toggle" type="button" aria-label="Turn on translated subtitles" title="Turn on translated subtitles">
          <img class="brand-icon" src="${chrome.runtime.getURL("assets/icons/transly-player.svg")}" alt="" aria-hidden="true">
          <span class="status-dot" aria-hidden="true"></span>
        </button>
        <button class="appearance" type="button" aria-label="Subtitle appearance" title="Subtitle appearance" aria-expanded="false">
          <span class="caret" aria-hidden="true"></span>
        </button>
        <div class="panel" hidden>
          <p class="panel-title">Subtitle appearance</p>
          <div class="segment" aria-label="Subtitle display mode">
            <button type="button" data-mode="source-only" aria-pressed="false">Original</button>
            <button type="button" data-mode="translation-only" aria-pressed="false">Translation</button>
            <button type="button" data-mode="bilingual" aria-pressed="true">Both</button>
          </div>
          <div class="order-setting">
            <span class="setting-label">Order</span>
            <div class="segment two" aria-label="Bilingual subtitle order">
              <button type="button" data-order="source-first" aria-pressed="true">Original first</button>
              <button type="button" data-order="translation-first" aria-pressed="false">Translation first</button>
            </div>
          </div>
          <div class="range-row">
            <label for="transly-source-size">Original size</label>
            <input id="transly-source-size" data-setting="subtitleSourceFontSizePx" type="range" min="14" max="56" step="1">
            <output data-output="subtitleSourceFontSizePx"></output>
          </div>
          <div class="range-row">
            <label for="transly-translation-size">Translation size</label>
            <input id="transly-translation-size" data-setting="subtitleTranslationFontSizePx" type="range" min="14" max="56" step="1">
            <output data-output="subtitleTranslationFontSizePx"></output>
          </div>
          <div class="range-row">
            <label for="transly-position">Position</label>
            <input id="transly-position" data-setting="subtitlePositionPercent" type="range" min="2" max="30" step="1">
            <output data-output="subtitlePositionPercent"></output>
          </div>
          <div class="range-row">
            <label for="transly-background">Background</label>
            <input id="transly-background" data-setting="subtitleBackgroundOpacity" type="range" min="0" max="0.9" step="0.05">
            <output data-output="subtitleBackgroundOpacity"></output>
          </div>
          <p class="error" role="status"></p>
        </div>
      </div>
    `;

    playerControlsShadow.querySelector(".toggle").addEventListener("click", () => {
      setSubtitleEnabledFromPlayer(!subtitleEnabled).catch((error) => setSubtitleStatus("error", error));
    });
    const appearanceButton = playerControlsShadow.querySelector(".appearance");
    appearanceButton.addEventListener("click", (event) => {
      event.stopPropagation();
      playerPanelOpen = !playerPanelOpen;
      schedulePlayerControlsPosition();
      appearanceButton.setAttribute("aria-expanded", String(playerPanelOpen));
      playerControlsShadow.querySelector(".panel").hidden = !playerPanelOpen;
    });
    playerControlsShadow.querySelector(".panel").addEventListener("click", (event) => event.stopPropagation());
    for (const button of playerControlsShadow.querySelectorAll("[data-mode]")) {
      button.addEventListener("click", () => saveAppearance({ subtitleDisplayMode: button.dataset.mode }));
    }
    for (const button of playerControlsShadow.querySelectorAll("[data-order]")) {
      button.addEventListener("click", () => saveAppearance({ subtitleLanguageOrder: button.dataset.order }));
    }
    for (const input of playerControlsShadow.querySelectorAll("input[data-setting]")) {
      input.addEventListener("input", () => saveAppearance({ [input.dataset.setting]: Number(input.value) }));
    }
    document.addEventListener("pointerdown", closePlayerPanelOnOutsideClick, true);
    updatePlayerControls();
  }

  function closePlayerPanelOnOutsideClick(event) {
    if (!playerPanelOpen || event.composedPath().includes(playerControlsHost)) return;
    playerPanelOpen = false;
    playerControlsShadow.querySelector(".panel").hidden = true;
    playerControlsShadow.querySelector(".appearance").setAttribute("aria-expanded", "false");
  }

  async function setSubtitleEnabledFromPlayer(enabled) {
    setSubtitleStatus(enabled ? "detecting" : "off");
    const response = await saveSettings({ subtitleEnabled: enabled, targetLanguage });
    if (response?.ok === false) throw new Error(response.error || "Could not save subtitle setting");
    if (enabled) await enableSubtitles(targetLanguage);
    else disableSubtitles();
  }

  function schedulePlayerControlsPosition() {
    if (controlsPositionFrame) return;
    controlsPositionFrame = requestAnimationFrame(() => {
      controlsPositionFrame = 0;
      positionPlayerControls();
    });
  }

  function positionPlayerControls() {
    if (!playerControlsHost?.isConnected) return;
    const video = chooseVideo();
    if (!video) {
      if (playerControlsHost.dataset.placement === "floating") playerControlsHost.style.display = "none";
      return;
    }
    playerControlsVideo = video;
    const rect = video.getBoundingClientRect();
    if (playerControlsHost.dataset.placement !== "floating") return;
    if (rect.width < 180 || rect.height < 100 || rect.bottom <= 0 || rect.top >= innerHeight) {
      playerControlsHost.style.display = "none";
      return;
    }
    playerControlsHost.style.display = "flex";
    const controlWidth = playerControlsHost.getBoundingClientRect().width || 176;
    const youtubeControls = video.closest(".html5-video-player")?.querySelector(".ytp-right-controls");
    const youtubeControlsRect = youtubeControls?.getBoundingClientRect();
    const hasVisibleYoutubeControls = youtubeControlsRect
      && youtubeControlsRect.width > 0
      && youtubeControlsRect.height > 0;
    const controlHeight = playerControlsHost.getBoundingClientRect().height || 48;
    const controlTop = hasVisibleYoutubeControls
      ? youtubeControlsRect.top + (youtubeControlsRect.height - controlHeight) / 2
      : rect.bottom - controlHeight - 12;
    const controlLeft = hasVisibleYoutubeControls
      ? youtubeControlsRect.left - controlWidth - 8
      : rect.right - controlWidth - 16;
    playerControlsHost.style.left = `${Math.max(8, controlLeft)}px`;
    playerControlsHost.style.top = `${controlTop}px`;
    playerControlsHost.style.setProperty(
      "--transly-panel-max-height",
      `${Math.max(120, Math.min(420, controlTop - 16))}px`
    );
  }

  function applyAppearanceSettings(settings) {
    appearance = {
      subtitleDisplayMode: allowedSetting(
        settings.subtitleDisplayMode,
        ["bilingual", "source-only", "translation-only"],
        appearance.subtitleDisplayMode
      ),
      subtitleLanguageOrder: allowedSetting(
        settings.subtitleLanguageOrder,
        ["source-first", "translation-first"],
        appearance.subtitleLanguageOrder
      ),
      subtitleSourceFontSizePx: subtitleFontSize(
        settings,
        "subtitleSourceFontSizePx",
        "subtitleSourceFontScale",
        appearance.subtitleSourceFontSizePx
      ),
      subtitleTranslationFontSizePx: subtitleFontSize(
        settings,
        "subtitleTranslationFontSizePx",
        "subtitleTranslationFontScale",
        appearance.subtitleTranslationFontSizePx
      ),
      subtitlePositionPercent: clampNumber(settings.subtitlePositionPercent, 2, 30, appearance.subtitlePositionPercent),
      subtitleBackgroundOpacity: clampNumber(settings.subtitleBackgroundOpacity, 0, 0.9, appearance.subtitleBackgroundOpacity)
    };
    applyAppearanceToCaption(document.querySelector("#transly-caption-window"));
    updatePlayerControls();
  }

  function applyAppearanceToCaption(node) {
    if (!node) return;
    node.dataset.displayMode = appearance.subtitleDisplayMode;
    node.dataset.languageOrder = appearance.subtitleLanguageOrder;
    node.style.setProperty(
      "--transly-subtitle-source-font-size",
      `${appearance.subtitleSourceFontSizePx}px`
    );
    node.style.setProperty(
      "--transly-subtitle-translation-font-size",
      `${appearance.subtitleTranslationFontSizePx}px`
    );
    node.style.setProperty("--transly-subtitle-background-opacity", String(appearance.subtitleBackgroundOpacity));
  }

  function updatePlayerControls() {
    if (!playerControlsHost || !playerControlsShadow) return;
    playerControlsHost.dataset.enabled = String(subtitleEnabled);
    playerControlsHost.dataset.state = subtitleStatus;
    const toggle = playerControlsShadow.querySelector(".toggle");
    const action = subtitleEnabled ? "Turn off translated subtitles" : "Turn on translated subtitles";
    toggle.setAttribute("aria-label", action);
    toggle.title = action;
    toggle.setAttribute("aria-pressed", String(subtitleEnabled));
    for (const button of playerControlsShadow.querySelectorAll("[data-mode]")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === appearance.subtitleDisplayMode));
    }
    for (const button of playerControlsShadow.querySelectorAll("[data-order]")) {
      button.setAttribute("aria-pressed", String(button.dataset.order === appearance.subtitleLanguageOrder));
    }
    playerControlsShadow.querySelector(".order-setting").hidden = appearance.subtitleDisplayMode !== "bilingual";
    for (const input of playerControlsShadow.querySelectorAll("input[data-setting]")) {
      input.value = String(appearance[input.dataset.setting]);
    }
    const sourceFontOutput = playerControlsShadow.querySelector('[data-output="subtitleSourceFontSizePx"]');
    const translationFontOutput = playerControlsShadow.querySelector('[data-output="subtitleTranslationFontSizePx"]');
    const positionOutput = playerControlsShadow.querySelector('[data-output="subtitlePositionPercent"]');
    const backgroundOutput = playerControlsShadow.querySelector('[data-output="subtitleBackgroundOpacity"]');
    sourceFontOutput.value = `${Math.round(appearance.subtitleSourceFontSizePx)}px`;
    translationFontOutput.value = `${Math.round(appearance.subtitleTranslationFontSizePx)}px`;
    positionOutput.value = `${Math.round(appearance.subtitlePositionPercent)}%`;
    backgroundOutput.value = `${Math.round(appearance.subtitleBackgroundOpacity * 100)}%`;
    playerControlsShadow.querySelector(".error").textContent = subtitleStatus === "error" ? subtitleError : "";
  }

  function saveAppearance(patch) {
    applyAppearanceSettings(patch);
    saveSettings(patch).catch((error) => setSubtitleStatus("error", error));
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function subtitleFontSize(settings, pixelKey, legacyScaleKey, fallback) {
    if (settings[pixelKey] !== undefined) return clampNumber(settings[pixelKey], 14, 56, fallback);
    if (settings[legacyScaleKey] !== undefined) {
      return clampNumber(Math.round(Number(settings[legacyScaleKey]) * 30), 14, 56, fallback);
    }
    return fallback;
  }

  function allowedSetting(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function hideCaption(windowEl) {
    if (windowEl) windowEl.style.display = "none";
    document.documentElement.dataset.translySubtitlesRendering = "false";
  }

  function subtitleBottomInset(video, rect) {
    const preferredInset = Math.max(12, rect.height * (appearance.subtitlePositionPercent / 100));
    const youtubePlayer = video.closest(".html5-video-player");
    if (!youtubePlayer || youtubePlayer.classList.contains("ytp-autohide")) return preferredInset;
    return preferredInset + Math.min(72, Math.max(48, rect.height * 0.08));
  }

  function chooseVideo() {
    return [...trackedVideos.keys()]
      .filter((video) => video.isConnected)
      .map((video) => {
        const rect = video.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
        const visibleHeight = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
        const playingBonus = !video.paused && !video.ended ? 1_000_000_000 : 0;
        return { video, score: playingBonus + visibleWidth * visibleHeight };
      })
      .sort((left, right) => right.score - left.score)[0]?.video || null;
  }

  function hideSelectedTextTrack() {
    const source = sourceCueSets.get(activeSourceKey);
    if (source?.type !== "texttrack" || !source.track) return;
    const record = trackedVideos.get(source.video)?.tracks?.get(source.track);
    if (!record || source.track.mode !== "showing") return;
    if (record.restoreMode === null) record.restoreMode = source.track.mode;
    source.track.mode = "hidden";
  }

  function activateTextTrackCandidate() {
    if (!subtitleEnabled || activeCues.length) return;
    const video = chooseVideo();
    const record = trackedVideos.get(video);
    if (!record) return;
    const candidates = [...record.tracks.keys()].filter((track) => (
      ["captions", "subtitles"].includes(track.kind)
      && !core.sameLanguage(track.language, targetLanguage)
    ));
    const track = candidates.find((candidate) => candidate.mode !== "disabled") || candidates[0];
    const trackRecord = record.tracks.get(track);
    if (!track || !trackRecord) return;
    if (track.mode === "disabled") {
      trackRecord.restoreMode = track.mode;
      track.mode = "hidden";
    }
    ingestTextTrack(video, track);
  }

  function restoreTextTracks() {
    for (const record of trackedVideos.values()) {
      for (const [track, trackRecord] of record.tracks) {
        if (trackRecord.restoreMode !== null) track.mode = trackRecord.restoreMode;
        trackRecord.restoreMode = null;
      }
    }
  }

  function triggerSiteCaptions() {
    setTimeout(() => {
      if (!subtitleEnabled || activeCues.length) return;
      const button = document.querySelector(".ytp-subtitles-button");
      if (!button) return;
      const enabled = button.getAttribute("aria-pressed") === "true";
      if (!enabled) button.click();
    }, 250);
  }

  function armNoCaptionsTimeout() {
    clearTimeout(noCaptionsTimer);
    noCaptionsTimer = setTimeout(() => {
      if (subtitleEnabled && !activeCues.length) setSubtitleStatus("no-captions");
    }, NO_CAPTIONS_TIMEOUT_MS);
  }

  function setSubtitleStatus(status, error = "") {
    subtitleStatus = status;
    subtitleError = error ? String(error?.message || error) : "";
    document.documentElement.dataset.translySubtitlesEnabled = String(subtitleEnabled);
    document.documentElement.dataset.translySubtitleStatus = status;
    document.documentElement.dataset.translySubtitleCueCount = String(activeCues.length);
    if (subtitleError) document.documentElement.dataset.translySubtitleError = subtitleError;
    else delete document.documentElement.dataset.translySubtitleError;
    updatePlayerControls();
  }

  function subtitleState() {
    return {
      subtitleEnabled,
      subtitleStatus,
      subtitleError,
      subtitleCueCount: activeCues.length,
      subtitleTranslatedCueCount: translatedById.size
    };
  }

  function hasAnyTranslation() {
    return activeCues.some((cue) => translatedById.has(cue.id));
  }

  function buildSubtitleContext(cues, batch = []) {
    const requestedIds = new Set(batch.map((cue) => cue.id));
    const requestedIndexes = cues
      .map((cue, index) => requestedIds.has(cue.id) ? index : -1)
      .filter((index) => index >= 0);
    const first = requestedIndexes.length ? Math.max(0, Math.min(...requestedIndexes) - 6) : 0;
    const last = requestedIndexes.length ? Math.min(cues.length, Math.max(...requestedIndexes) + 7) : cues.length;
    return [document.title, cues.slice(first, last).map((cue) => cue.text).join("\n").slice(0, 12000)]
      .filter(Boolean)
      .join("\n\n");
  }

  function requestTranslation(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "TRANSLY_TRANSLATE", payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.ok) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || "Subtitle translation failed"));
        }
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

  function saveSettings(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "TRANSLY_SAVE_SETTINGS", payload }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response || { ok: true });
      });
    });
  }

  async function sha256(input) {
    const bytes = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
})(globalThis);
