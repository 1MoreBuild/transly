const PASSAGE_SEPARATOR = "\n\n%%\n\n";

const LANGUAGE_NAMES = new Map([
  ["zh-CN", "Simplified Chinese"],
  ["zh-TW", "Traditional Chinese"],
  ["zh-HK", "Traditional Chinese (Hong Kong)"],
  ["en", "English"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["fr", "French"],
  ["de", "German"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
  ["pt-BR", "Brazilian Portuguese"]
]);

export function buildTranslationRequest(payload) {
  const targetLanguage = languageName(payload.targetLanguage);
  const isSubtitle = payload.mode === "subtitle";
  const instructions = isSubtitle
    ? buildSubtitleInstructions(targetLanguage)
    : buildArticleInstructions(targetLanguage);
  const repairInstruction = payload.placeholderRepair
    ? "This is a repair retry. Before returning, verify that every [[TRANSLY_PH_n]] token from each passage appears exactly once in that passage's translation."
    : "";
  const context = cleanContext(payload.context);
  const passages = payload.items.map((item) => String(item.text || "").trim()).join(PASSAGE_SEPARATOR);

  return {
    instructions: [instructions, repairInstruction].filter(Boolean).join("\n"),
    prompt: [
      context ? "Read the context first. It is for meaning only and must not appear in the output." : "",
      context ? `CONTEXT\n${context}` : "",
      `TEXT TO TRANSLATE\n${passages}`
    ].filter(Boolean).join("\n\n")
  };
}

export function normalizeTranslationResult(parsed, payload) {
  if (Array.isArray(parsed)) {
    if (parsed.length !== payload.items.length) {
      throw new Error(`Translation item count mismatch: expected ${payload.items.length}, received ${parsed.length}`);
    }
    const items = payload.items.map((item, index) => ({
      id: item.id,
      translation: requireTranslationString(parsed[index], index)
    }));
    return { items };
  }

  // Keep compatibility with responses produced before the text-first protocol.
  const allowedIds = new Set(payload.items.map((item) => item.id));
  const byId = new Map();
  for (const item of parsed?.items || []) {
    if (!allowedIds.has(item?.id) || byId.has(item.id)) continue;
    byId.set(item.id, requireTranslationString(item.translation, item.id));
  }
  if (byId.size !== payload.items.length) {
    throw new Error(`Translation item count mismatch: expected ${payload.items.length}, received ${byId.size}`);
  }
  return {
    items: payload.items.map((item) => ({ id: item.id, translation: byId.get(item.id) }))
  };
}

function requireTranslationString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid or empty translation for item ${label}.`);
  }
  return value.trim();
}

function buildArticleInstructions(targetLanguage) {
  const languageGuidance = buildArticleLanguageGuidance(targetLanguage);
  return [
    `You are a native ${targetLanguage} editorial translator.`,
    `Write natural, publication-ready ${targetLanguage} that reads as if it were originally written in ${targetLanguage}.`,
    "Translate meaning rather than source-language sentence structure. Reorder clauses and reshape sentences within each passage whenever the target language reads more naturally that way.",
    "Avoid translationese, literal calques, and source-language word order. Render idioms and metaphors by their intended meaning and rhetorical effect; if their imagery is not idiomatic in the target language, replace it with a natural target-language expression instead of preserving the source words or image.",
    "Preserve facts, nuance, emphasis, tone, and the author's voice. Do not summarize, explain, censor, embellish, or add information.",
    "Keep proper nouns, product and model names, code identifiers, URLs, placeholder tokens such as [[TRANSLY_PH_0]], and technical terms without an established translation unchanged.",
    "For technical writing, use terminology practitioners actually use. Keep an English technical term when translating it would be ambiguous, less precise, or unnatural; do not translate every English term by force.",
    languageGuidance,
    "Translate headings as concise headings and prose as fluent prose.",
    `Before returning, silently edit every passage as a native ${targetLanguage} editor: remove awkward literal phrasing and source-language syntax while preserving every fact, distinction, and tone. Return only the edited final translation.`,
    "Return only a valid JSON array of translated strings in input order, with exactly one string for each passage separated by %% in the input."
  ].filter(Boolean).join("\n");
}

function buildArticleLanguageGuidance(targetLanguage) {
  if (targetLanguage !== "Simplified Chinese") return "";
  return [
    "Use direct, contemporary written Chinese with compact clauses and natural Chinese information order.",
    "Natural Chinese takes priority over retaining an English metaphor's image. For example, translate 'sent me down a rabbit hole' by its meaning, such as '让我连续深挖了两天' or '让我追查了两天'; never write '兔子洞' unless the passage is about a literal rabbit hole."
  ].join(" ");
}

function buildSubtitleInstructions(targetLanguage) {
  return [
    `You are a native ${targetLanguage} subtitle translator.`,
    `Write natural, concise ${targetLanguage} that is easy to read at playback speed.`,
    "Preserve meaning, tone, speaker intent, names, code, numbers, and placeholder tokens. Do not explain or add information.",
    "Return only a valid JSON array of translated strings in input order, with exactly one string for each subtitle separated by %% in the input."
  ].join("\n");
}

function cleanContext(context) {
  return String(context || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function languageName(code) {
  const normalized = String(code || "").trim();
  return LANGUAGE_NAMES.get(normalized) || normalized || "the target language";
}
