(function initializeSubtitleCore(global) {
  function parseSubtitle(body, url = "") {
    const text = String(body || "").trim();
    if (!text) return [];
    if (/aisubtitle\.hdslb\.com\/bfs/i.test(url)) return parseBilibiliSubtitle(text);
    if (/\/api\/timedtext/i.test(url) || /^<\?xml|<transcript/i.test(text)) {
      return parseYouTubeTimedText(text);
    }
    if (/WEBVTT|^\d+\s*\n\d\d:/i.test(text)) return parseVtt(text);
    return [];
  }

  function parseYouTubeTimedText(text) {
    if (/^[{[]/.test(text)) {
      try {
        const data = JSON.parse(text);
        const events = Array.isArray(data?.events) ? data.events : [];
        return normalizeCues(events.map((event) => ({
          start: Number(event.tStartMs || 0) / 1000,
          end: (Number(event.tStartMs || 0) + Number(event.dDurationMs || 0)) / 1000,
          text: (event.segs || []).map((segment) => segment?.utf8 || "").join("")
        })));
      } catch {
        return [];
      }
    }

    const cues = [];
    const pattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = pattern.exec(text))) {
      const attributes = match[1];
      const start = Number(attributeValue(attributes, "start") || 0);
      const duration = Number(attributeValue(attributes, "dur") || 2.5);
      cues.push({ start, end: start + duration, text: decodeEntities(match[2]) });
    }
    return normalizeCues(cues);
  }

  function parseBilibiliSubtitle(text) {
    try {
      const data = JSON.parse(text);
      const items = Array.isArray(data?.body) ? data.body : [];
      return normalizeCues(items.map((item) => ({
        start: Number(item.from ?? item.start ?? 0),
        end: Number(item.to ?? item.end ?? Number(item.from || 0) + 2.5),
        text: item.content || item.text || ""
      })));
    } catch {
      return [];
    }
  }

  function parseVtt(text) {
    const blocks = text.replace(/^\uFEFF/, "").replace(/\r/g, "").split(/\n{2,}/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;
      const [startRaw, endRaw] = lines[timingIndex].split("-->").map((value) => value.trim().split(/\s+/)[0]);
      cues.push({
        start: parseTime(startRaw),
        end: parseTime(endRaw),
        text: lines.slice(timingIndex + 1).join(" ")
      });
    }
    return normalizeCues(cues);
  }

  function normalizeCues(cues) {
    const normalized = [];
    for (const cue of Array.isArray(cues) ? cues : []) {
      const start = Number(cue?.start ?? cue?.startTime);
      const requestedEnd = Number(cue?.end ?? cue?.endTime);
      const text = compactText(cue?.text);
      if (!Number.isFinite(start) || !text || isAmbientOnly(text)) continue;
      const end = Number.isFinite(requestedEnd) && requestedEnd > start ? requestedEnd : start + 2.5;
      const previous = normalized.at(-1);
      if (previous && previous.text === text && start <= previous.end + 0.08) {
        previous.end = Math.max(previous.end, end);
        continue;
      }
      normalized.push({ id: cueId(start, end, text), start, end, text });
    }
    return normalized.sort((left, right) => left.start - right.start || left.end - right.end);
  }

  function mergeCues(existing, incoming, maxCues = 5000) {
    const byId = new Map((Array.isArray(existing) ? existing : []).map((cue) => [cue.id, cue]));
    for (const cue of normalizeCues(incoming)) byId.set(cue.id, cue);
    return [...byId.values()]
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .slice(-maxCues);
  }

  function chunkCues(cues, options = {}) {
    const maxChars = clamp(options.maxChars, 800, 20000, 5000);
    const maxItems = clamp(options.maxItems, 4, 100, 40);
    const chunks = [];
    let current = [];
    let chars = 0;
    for (const cue of cues) {
      const weight = cue.text.length + 40;
      if (current.length && (chars + weight > maxChars || current.length >= maxItems)) {
        chunks.push(current);
        current = [];
        chars = 0;
      }
      current.push(cue);
      chars += weight;
    }
    if (current.length) chunks.push(current);
    return chunks;
  }

  function groupCuesByMeaning(cues, options = {}) {
    const maxChars = clamp(options.maxChars, 80, 600, 260);
    const maxCues = clamp(options.maxCues, 2, 12, 6);
    const maxDuration = clampDecimal(options.maxDuration, 4, 20, 12);
    const maxGap = clampDecimal(options.maxGap, 0.2, 3, 1.25);
    const groups = [];
    let current = [];

    for (const cue of [...cues].sort((left, right) => left.start - right.start || left.end - right.end)) {
      const previous = current.at(-1);
      const shouldStartNew = previous && (
        cue.start - previous.end > maxGap
        || cue.end - current[0].start > maxDuration
        || current.length >= maxCues
        || current.reduce((total, item) => total + item.text.length, 0) + cue.text.length > maxChars
        || startsNewSpeaker(cue.text)
      );
      if (shouldStartNew) {
        groups.push(createCueGroup(current));
        current = [];
      }
      current.push(cue);
      if (endsUtterance(cue.text)) {
        groups.push(createCueGroup(current));
        current = [];
      }
    }
    if (current.length) groups.push(createCueGroup(current));
    return groups;
  }

  function prioritizeCueGroups(groups, currentTime) {
    const now = Number(currentTime) || 0;
    return [...groups].sort((left, right) => (
      cueDistance(left, now) - cueDistance(right, now)
      || left.start - right.start
    ));
  }

  function selectCueGroupsForPlayback(groups, currentTime, options = {}) {
    const now = Number(currentTime) || 0;
    const behindSeconds = clampDecimal(options.behindSeconds, 0, 300, 30);
    const aheadSeconds = clampDecimal(options.aheadSeconds, 10, 900, 120);
    const windowStart = Math.max(0, now - behindSeconds);
    const windowEnd = now + aheadSeconds;
    const nearby = groups.filter((group) => (
      group.end >= windowStart && group.start <= windowEnd
    ));
    return prioritizeCueGroups(nearby.length ? nearby : groups, now)
      .slice(0, nearby.length || 1);
  }

  function chunkCueGroups(groups, options = {}) {
    const maxChars = clamp(options.maxChars, 400, 12000, 1200);
    const maxItems = clamp(options.maxItems, 2, 40, 12);
    const chunks = [];
    let current = [];
    let chars = 0;

    for (const group of groups) {
      const groupChars = group.cues.reduce((total, cue) => total + cue.text.length + 40, 0);
      if (current.length && (chars + groupChars > maxChars || countGroupCues(current) + group.cues.length > maxItems)) {
        chunks.push(flattenCueGroups(current));
        current = [];
        chars = 0;
      }
      current.push(group);
      chars += groupChars;
    }
    if (current.length) chunks.push(flattenCueGroups(current));
    return chunks;
  }

  function chunkCueGroupsForPlayback(groups, currentTime, options = {}) {
    const prioritized = prioritizeCueGroups(groups, currentTime);
    if (!prioritized.length) return [];
    const now = Number(currentTime) || 0;
    const primaryStart = Math.max(0, now - clampDecimal(options.primaryBehindSeconds, 0, 300, 60));
    const primaryEnd = now + clampDecimal(options.primaryAheadSeconds, 10, 300, 60);
    const primary = prioritized.filter((group) => group.end >= primaryStart && group.start <= primaryEnd);
    const primaryGroups = primary.length ? primary : prioritized.slice(0, 1);
    const primaryIds = new Set(primaryGroups.map((group) => group.id));
    const remaining = prioritized.filter((group) => !primaryIds.has(group.id));
    return [
      ...chunkCueGroups(primaryGroups, {
        maxChars: options.primaryMaxChars ?? 6000,
        maxItems: options.primaryMaxItems ?? 40
      }),
      ...chunkCueGroups(remaining, options)
    ];
  }

  function prioritizeCues(cues, currentTime) {
    const now = Number(currentTime) || 0;
    return [...cues].sort((left, right) => cueDistance(left, now) - cueDistance(right, now) || left.start - right.start);
  }

  function activeCueAt(cues, currentTime) {
    const now = Number(currentTime) || 0;
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const cue = cues[middle];
      if (now < cue.start) high = middle - 1;
      else if (now > cue.end) low = middle + 1;
      else return cue;
    }
    return null;
  }

  function subtitleLanguageFromUrl(url) {
    try {
      const parsed = new URL(url, global.location?.href || "https://example.invalid");
      return parsed.searchParams.get("tlang") || parsed.searchParams.get("lang") || "";
    } catch {
      return "";
    }
  }

  function sameLanguage(left, right) {
    const normalize = (value) => String(value || "").toLowerCase().replace(/_/g, "-");
    const a = normalize(left);
    const b = normalize(right);
    if (!a || !b) return false;
    return a === b || a.split("-")[0] === b.split("-")[0];
  }

  function inferSubtitleLanguage(cuesOrText) {
    const sample = (Array.isArray(cuesOrText)
      ? cuesOrText.map((cue) => cue?.text || "").join("\n")
      : String(cuesOrText || ""))
      .slice(0, 6000);
    if (!sample) return "";

    const kanaCount = countMatches(sample, /[\u3040-\u30ff]/gu);
    if (kanaCount >= 2) return "ja";

    const hangulCount = countMatches(sample, /[\uac00-\ud7af]/gu);
    if (hangulCount >= 2) return "ko";

    const hanCount = countMatches(sample, /\p{Script=Han}/gu);
    const letterCount = countMatches(sample, /\p{Letter}/gu);
    if (hanCount >= 3 && hanCount / Math.max(1, letterCount) >= 0.2) return "zh";
    return "";
  }

  function countMatches(text, pattern) {
    return [...String(text || "").matchAll(pattern)].length;
  }

  function parseTime(value) {
    const parts = String(value || "0").replace(",", ".").split(":");
    const seconds = Number(parts.pop() || 0);
    const minutes = Number(parts.pop() || 0);
    const hours = Number(parts.pop() || 0);
    return hours * 3600 + minutes * 60 + seconds;
  }

  function compactText(text) {
    return decodeEntities(String(text || "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  }

  function decodeEntities(text) {
    return String(text || "")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&(?:amp|#38);/gi, "&")
      .replace(/&(?:lt|#60);/gi, "<")
      .replace(/&(?:gt|#62);/gi, ">")
      .replace(/&(?:quot|#34);/gi, "\"")
      .replace(/&(?:apos|#39);/gi, "'")
      .replace(/&nbsp;/gi, " ");
  }

  function attributeValue(attributes, name) {
    return attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1] || "";
  }

  function cueId(start, end, text) {
    let hash = 2166136261;
    const value = `${Math.round(start * 1000)}:${Math.round(end * 1000)}:${text}`;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `cue-${Math.round(start * 1000)}-${(hash >>> 0).toString(36)}`;
  }

  function isAmbientOnly(text) {
    return /^(?:\([^)]{1,80}\)|\[[^\]]{1,80}\]|[♪♫\s]+)$/u.test(text);
  }

  function cueDistance(cue, now) {
    if (now >= cue.start && now <= cue.end) return 0;
    return now < cue.start ? cue.start - now : now - cue.end;
  }

  function createCueGroup(cues) {
    const first = cues[0];
    const last = cues.at(-1);
    return {
      id: `group-${first.id}-${last.id}`,
      start: first.start,
      end: last.end,
      cues: cues.slice()
    };
  }

  function flattenCueGroups(groups) {
    return groups.flatMap((group, groupIndex) => group.cues.map((cue) => ({
      ...cue,
      subtitleGroup: groupIndex + 1
    })));
  }

  function countGroupCues(groups) {
    return groups.reduce((total, group) => total + group.cues.length, 0);
  }

  function endsUtterance(text) {
    return /[.!?。！？…](?:["'’”〉》」』】〕〗〙〛)]*)$/u.test(String(text || "").trim());
  }

  function startsNewSpeaker(text) {
    return /^(?:>>|[-–—]\s+|[A-Z][A-Z0-9 _-]{1,24}:\s+)/u.test(String(text || "").trim());
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  }

  function clampDecimal(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  global.TranslySubtitleCore = Object.freeze({
    activeCueAt,
    chunkCueGroups,
    chunkCueGroupsForPlayback,
    chunkCues,
    compactText,
    groupCuesByMeaning,
    inferSubtitleLanguage,
    mergeCues,
    normalizeCues,
    parseSubtitle,
    parseTime,
    prioritizeCues,
    prioritizeCueGroups,
    selectCueGroupsForPlayback,
    sameLanguage,
    subtitleLanguageFromUrl
  });
})(globalThis);
