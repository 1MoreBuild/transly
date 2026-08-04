export type RuntimeResponse<T = unknown> = {
  ok?: boolean;
  data?: T;
  error?: string;
};

export function sendRuntimeMessage<T = unknown>(message: unknown): Promise<RuntimeResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T> | undefined) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "The extension did not return a response." });
    });
  });
}

export function splitModelName(value: string) {
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1) return { name: value, provider: "" };
  return {
    name: value.slice(separator + 1),
    provider: value.slice(0, separator)
  };
}

export function filterTranslationModels(models: unknown[]) {
  const unsupported = /(embedding|whisper|tts|speech|audio|image|dall-e|moderation|realtime|transcrib)/i;
  return [...new Set(models.map((value) => String(value).trim()).filter(Boolean))]
    .filter((value) => !unsupported.test(value))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export const TARGET_LANGUAGES = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "pt-BR", label: "Português" }
] as const;
