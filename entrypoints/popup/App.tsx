import { Select } from "@base-ui/react/select";
import { Check, ChevronDown, Languages, LoaderCircle, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  filterTranslationModels,
  sendRuntimeMessage,
  splitModelName,
  TARGET_LANGUAGES
} from "../../src/ui/extension-api";
import { resolveActiveArticleTarget, sendToActiveTab, sendToTabFrame } from "../../src/ui/popup-tab";

type ArticleStatus = "idle" | "running" | "translated" | "error";
type ProviderSummary = {
  configured?: boolean;
  available?: boolean;
  error?: string;
  host?: string;
  model?: string;
  provider?: { name?: string; icon?: string };
};

const sourceTabId = Number(new URLSearchParams(location.search).get("tabId") || 0);

export function App() {
  const [targetLanguage, setTargetLanguage] = useState("zh-CN");
  const [displayMode, setDisplayMode] = useState("bilingual");
  const [provider, setProvider] = useState<ProviderSummary>({});
  const [providerChecked, setProviderChecked] = useState(false);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [articleStatus, setArticleStatus] = useState<ArticleStatus>("idle");
  const [articleError, setArticleError] = useState("");
  const [hasTranslation, setHasTranslation] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const providerConfigured = Boolean(provider.configured);
  const providerAvailable = provider.available !== false;
  const providerState = !providerChecked
    ? "Checking"
    : !providerConfigured
      ? "Setup required"
      : providerAvailable ? "Ready" : "Offline";
  const engineState = providerConfigured && providerAvailable ? "ready" : "error";

  useEffect(() => {
    let active = true;
    Promise.all([
      sendRuntimeMessage<any>({ type: "TRANSLY_GET_SETTINGS" }),
      loadPageState()
    ]).then(async ([settings, pageState]) => {
      if (!active) return;
      if (settings.ok) {
        setTargetLanguage(settings.data?.targetLanguage || "zh-CN");
        setDisplayMode(settings.data?.articleDisplayMode || "bilingual");
      }
      if (pageState?.ok) {
        const data = pageState.data || {};
        const nextStatus = data.articleStatus || (data.articleTranslated ? "translated" : "idle");
        setArticleStatus(normalizeArticleStatus(nextStatus));
        setArticleError(String(data.articleError || ""));
        setHasTranslation(Boolean(data.articleTranslated));
      }
      const response = await sendRuntimeMessage<ProviderSummary>({ type: "TRANSLY_PROVIDER_STATUS" });
      if (!active) return;
      if (response.ok && response.data?.configured) {
        setProvider(response.data);
        setModel(response.data.model || "Custom model");
        if (response.data.available === false) setStatusMessage(providerUnavailableMessage(response.data));
        else if (pageState?.data?.articleStatus === "error") {
          setStatusMessage(articleFailureMessage(pageState.data.articleError));
        }
      } else {
        setProvider({ configured: false, available: false });
        setModel("Not configured");
        setStatusMessage(response.error || "Add an API URL, key, and model to begin.");
      }
      setProviderChecked(true);
    });
    return () => { active = false; };
  }, []);

  const loadModels = useCallback(async () => {
    if (!providerConfigured || modelsLoaded || modelsLoading) return;
    setModelsLoading(true);
    const response = await sendRuntimeMessage<any>({ type: "TRANSLY_LIST_CONFIGURED_MODELS" });
    if (response.ok) {
      setModels(filterTranslationModels(response.data?.models || []));
      if (response.data?.currentModel) setModel(response.data.currentModel);
      setModelsLoaded(true);
    } else {
      setStatusMessage(response.error || "Could not load models.");
    }
    setModelsLoading(false);
  }, [modelsLoaded, modelsLoading, providerConfigured]);

  async function selectModel(value: string | null) {
    if (!value || value === model) return;
    const previous = model;
    setModel(value);
    const response = await sendRuntimeMessage<ProviderSummary>({
      type: "TRANSLY_SELECT_PROVIDER_MODEL",
      model: value
    });
    if (!response.ok) {
      setModel(previous);
      setStatusMessage(response.error || "Could not switch models.");
      return;
    }
    setProvider(response.data || provider);
    setStatusMessage("");
  }

  async function changeLanguage(value: string | null) {
    if (!value) return;
    setTargetLanguage(value);
    setStatusMessage("");
    await sendRuntimeMessage({ type: "TRANSLY_SAVE_SETTINGS", payload: { targetLanguage: value } });
  }

  async function toggleDisplayMode() {
    const nextMode = displayMode === "translation-only" ? "bilingual" : "translation-only";
    setDisplayMode(nextMode);
    await sendRuntimeMessage({
      type: "TRANSLY_SAVE_SETTINGS",
      payload: { articleDisplayMode: nextMode }
    });
    try {
      await sendToActiveTab({ type: "TRANSLY_SET_ARTICLE_DISPLAY_MODE", mode: nextMode }, sourceTabId);
    } catch {
      // The saved setting applies when the next translatable page opens.
    }
  }

  async function runPrimaryAction() {
    setStatusMessage("");
    if (hasTranslation) {
      setArticleStatus("running");
      try {
        const response = await sendToActiveTab({ type: "TRANSLY_CLEAR_ARTICLE" }, sourceTabId);
        if (response?.ok === false) throw new Error(response.error || "Could not restore the original article");
        setHasTranslation(false);
        setArticleStatus("idle");
      } catch (error) {
        setHasTranslation(true);
        setArticleStatus("translated");
        setStatusMessage(String((error as Error)?.message || error));
      }
      return;
    }

    setArticleStatus("running");
    try {
      const response = await sendToActiveTab({
        type: "TRANSLY_TRANSLATE_ARTICLE",
        targetLanguage
      }, sourceTabId);
      if (response?.ok === false) throw new Error(response.error || "Translation failed");
      setTimeout(() => window.close(), 240);
    } catch (error) {
      setArticleStatus("idle");
      setStatusMessage(String((error as Error)?.message || error));
    }
  }

  const modelItems = useMemo(() => {
    const values = models.length ? models : model && model !== "Not configured" ? [model] : [];
    return values.map((value) => ({ value, label: splitModelName(value).name }));
  }, [model, models]);
  const running = articleStatus === "running";
  const primaryLabel = running
    ? "Translation in progress"
    : hasTranslation ? "Restore original" : "Translate this article";
  const providerIcon = provider.provider?.icon
    ? chrome.runtime.getURL(provider.provider.icon)
    : "";

  return (
    <main className="popup-shell">
      <section className="language-section" aria-label="Target language">
        <span className="section-label">Translate to</span>
        <Select.Root items={TARGET_LANGUAGES} value={targetLanguage} onValueChange={changeLanguage}>
          <Select.Trigger id="targetLanguage" className="compact-select" aria-label="Target language">
            <Select.Value />
            <Select.Icon className="select-chevron"><ChevronDown size={16} /></Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner className="select-positioner" align="end" sideOffset={6}>
              <Select.Popup className="select-popup language-popup">
                <Select.List className="select-list">
                  {TARGET_LANGUAGES.map((language) => (
                    <Select.Item
                      className="select-item language-option"
                      key={language.value}
                      value={language.value}
                    >
                      <span className="language-check-slot" aria-hidden="true">
                        <Select.ItemIndicator className="select-check"><Check size={15} /></Select.ItemIndicator>
                      </span>
                      <Select.ItemText className="language-option-label">{language.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </section>

      <section id="engineRow" className="engine-row" data-state={providerChecked ? engineState : "checking"}>
        <div className="provider-mark" role="img" aria-label={provider.provider?.name || "AI provider"}>
          {providerIcon
            ? <img id="providerIcon" src={providerIcon} alt="" />
            : <span id="providerFallback" aria-hidden="true">AI</span>}
        </div>
        <div className="engine-copy">
          <Select.Root
            items={modelItems}
            value={model || null}
            onValueChange={selectModel}
            onOpenChange={(open) => { if (open) void loadModels(); }}
            disabled={!providerConfigured}
          >
            <Select.Trigger id="popupModelTrigger" className="model-select" aria-label="Translation model">
              <strong id="modelValue">{splitModelName(model || "Checking…").name}</strong>
              {modelsLoading
                ? <LoaderCircle className="spin" size={14} />
                : <Select.Icon className="select-chevron"><ChevronDown size={15} /></Select.Icon>}
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner className="select-positioner" align="start" sideOffset={7}>
                <Select.Popup className="select-popup model-popup">
                  <Select.List id="popupModelList" className="select-list">
                    {modelItems.map((item) => {
                      const parts = splitModelName(item.value);
                      return (
                        <Select.Item
                          className="select-item popup-model-option"
                          data-value={item.value}
                          key={item.value}
                          value={item.value}
                        >
                          <span className="model-option-copy">
                            <span className="model-option-name">{parts.name}</span>
                            {parts.provider && <span className="model-option-provider">{parts.provider}</span>}
                          </span>
                          <Select.ItemIndicator className="select-check"><Check size={15} /></Select.ItemIndicator>
                        </Select.Item>
                      );
                    })}
                    {modelsLoaded && !modelItems.length && <p className="select-empty">No text models available.</p>}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
          <div className="provider-meta">
            <span className="provider-status-dot" aria-hidden="true" />
            <span id="providerValue">{provider.provider?.name || "AI provider"}</span>
            <span aria-hidden="true">·</span>
            <span id="providerState">{providerState}</span>
          </div>
        </div>
        <button
          id="configureProvider"
          className="icon-button"
          type="button"
          aria-label="Open translation settings"
          title="Translation settings"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          <Settings2 size={18} />
        </button>
      </section>

      <section className="primary-action-section">
        <div id="primaryActionRow" className="primary-action-row" data-has-translation={hasTranslation}>
          {hasTranslation && (
            <button
              id="articleDisplayMode"
              className="display-mode-action"
              type="button"
              data-mode={displayMode}
              aria-label={displayMode === "bilingual"
                ? "Bilingual view. Switch to translation only."
                : "Translation only. Switch to bilingual view."}
              title={displayMode === "bilingual" ? "Switch to translation only" : "Switch to bilingual view"}
              onClick={toggleDisplayMode}
            >
              <Languages size={19} />
            </button>
          )}
          <button
            id="translateArticle"
            className="primary-action"
            type="button"
            disabled={running || (!hasTranslation && !providerConfigured)}
            aria-busy={running}
            onClick={runPrimaryAction}
          >
            {running && <LoaderCircle className="spin" size={17} />}
            <span>{primaryLabel}</span>
          </button>
        </div>
        <p id="status" className="inline-status" role="status" aria-live="polite" hidden={!statusMessage}>
          {statusMessage}
        </p>
      </section>
    </main>
  );
}

async function loadPageState() {
  try {
    const target = await resolveActiveArticleTarget(sourceTabId);
    return await sendToTabFrame(target, { type: "TRANSLY_GET_PAGE_STATE" });
  } catch {
    return { ok: false };
  }
}

function normalizeArticleStatus(value: string): ArticleStatus {
  return ["running", "translated", "error"].includes(value)
    ? value as ArticleStatus
    : "idle";
}

function providerUnavailableMessage(summary: ProviderSummary) {
  const host = String(summary?.host || "").toLowerCase();
  if (host.includes("127.0.0.1") || host.includes("localhost") || host.includes("[::1]")) {
    return "Local translation service is offline. Start Lane or your provider, then try again.";
  }
  return "Translation service is unavailable. Check the provider connection, then try again.";
}

function articleFailureMessage(error: unknown) {
  const message = String(error || "").toLowerCase();
  if (/(failed to fetch|fetch failed|network|connection|econnrefused|503)/.test(message)) {
    return "Could not reach the translation service. Start it and try again.";
  }
  return "Translation failed. Try again, or check the provider settings.";
}
