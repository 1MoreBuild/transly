import { useCallback, useEffect, useMemo, useState } from "react";
import {
  normalizeUiLanguagePreference,
  resolveUiLanguage,
  translate,
  type MessageKey,
  type UiLanguagePreference
} from "./i18n";
import { sendRuntimeMessage } from "./extension-api";

type StoredSettings = {
  uiLanguage?: UiLanguagePreference;
  targetLanguage?: string;
  articleDisplayMode?: string;
};

export function useInterfaceLanguage() {
  const [preference, setPreference] = useState<UiLanguagePreference>("auto");
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  const language = resolveUiLanguage(preference);
  const t = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) => translate(language, key, values),
    [language]
  );

  useEffect(() => {
    let active = true;
    sendRuntimeMessage<StoredSettings>({ type: "TRANSLY_GET_SETTINGS" }).then((response) => {
      if (!active) return;
      const nextSettings = response.ok && response.data ? response.data : {};
      const nextPreference = normalizeUiLanguagePreference(nextSettings.uiLanguage);
      setPreference(nextPreference);
      setSettings(nextSettings);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "sync" || !changes.uiLanguage) return;
      const nextPreference = normalizeUiLanguagePreference(changes.uiLanguage.newValue);
      setPreference(nextPreference);
      setSettings((current) => ({ ...(current || {}), uiLanguage: nextPreference }));
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setUiLanguage = useCallback(async (value: string | null) => {
    const nextPreference = normalizeUiLanguagePreference(value);
    setPreference(nextPreference);
    setSettings((current) => ({ ...(current || {}), uiLanguage: nextPreference }));
    await sendRuntimeMessage({
      type: "TRANSLY_SAVE_SETTINGS",
      payload: { uiLanguage: nextPreference }
    });
  }, []);

  return useMemo(() => ({
    language,
    preference,
    settings,
    settingsReady: settings !== null,
    setUiLanguage,
    t
  }), [language, preference, setUiLanguage, settings, t]);
}
