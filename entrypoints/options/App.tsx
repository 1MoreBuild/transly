import { Combobox } from "@base-ui/react/combobox";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown, Eye, EyeOff, LoaderCircle, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { sendRuntimeMessage, splitModelName } from "../../src/ui/extension-api";

type Protocol = "auto" | "responses" | "chat-completions";
type ProviderConfig = { apiUrl: string; apiKey: string; model: string; protocol: Protocol };
type LocalProvider = {
  apiUrl: string;
  hint?: string;
  authRequired?: boolean;
  models?: string[];
};
type StatusTone = "neutral" | "success" | "error";

const PROTOCOLS = [
  { value: "auto", label: "Auto detect" },
  { value: "responses", label: "Responses API" },
  { value: "chat-completions", label: "Chat Completions" }
] as const;

export function App() {
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [protocol, setProtocol] = useState<Protocol>("auto");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState("");
  const [manualModel, setManualModel] = useState(false);
  const [savedConfiguration, setSavedConfiguration] = useState(false);
  const [busy, setBusy] = useState<"" | "connect" | "test" | "models">("");
  const [laneBusy, setLaneBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [showSaveWithoutTest, setShowSaveWithoutTest] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<LocalProvider[]>([]);
  const [discoveryLabel, setDiscoveryLabel] = useState("");

  const selectedModel = manualModel ? customModel.trim() : model.trim();
  const connection = useMemo(() => ({ apiUrl, apiKey, protocol }), [apiKey, apiUrl, protocol]);

  const showStatus = useCallback((message: string, tone: StatusTone = "neutral") => {
    setStatus(message);
    setStatusTone(tone);
  }, []);

  const updateModelChoices = useCallback((values: unknown[], preferred = "") => {
    const nextModels = normalizeModels(values);
    setModels(nextModels);
    const nextModel = preferred;
    if (nextModel && nextModels.includes(nextModel)) {
      setManualModel(false);
      setModel(nextModel);
      setCustomModel("");
    } else if (nextModel) {
      setManualModel(true);
      setCustomModel(nextModel);
      setModel("");
    } else if (nextModels.length) {
      setManualModel(false);
      setModel(chooseDefaultModel(nextModels));
      setCustomModel("");
    } else {
      setManualModel(true);
      setModel("");
    }
  }, []);

  const connectLaneProvider = useCallback(async ({ quiet = false } = {}) => {
    setLaneBusy(true);
    if (!quiet) showStatus("Connecting to Lane…");
    const response = await sendRuntimeMessage<any>({ type: "TRANSLY_CONNECT_LANE" });
    setLaneBusy(false);
    if (!response.ok) {
      if (!quiet) showStatus(response.error || "Lane is not available.", "error");
      return false;
    }
    const config = response.data.config as ProviderConfig;
    setApiUrl(config.apiUrl);
    setApiKey(config.apiKey);
    setProtocol(config.protocol || "auto");
    updateModelChoices(response.data.models || [], config.model);
    setSavedConfiguration(true);
    showStatus(`Connected to Lane with ${config.model}.`, "success");
    return true;
  }, [showStatus, updateModelChoices]);

  useEffect(() => {
    let active = true;
    sendRuntimeMessage<ProviderConfig>({ type: "TRANSLY_GET_PROVIDER_SETTINGS" })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok || !response.data) {
          showStatus(response.error || "Could not load settings.", "error");
          return;
        }
        const config = response.data;
        setApiUrl(config.apiUrl || "");
        setApiKey(config.apiKey || "");
        setProtocol(config.protocol || "auto");
        setSavedConfiguration(Boolean(config.apiUrl && config.model));
        if (config.model) updateModelChoices([config.model], config.model);
        if (!config.apiUrl) await connectLaneProvider({ quiet: true });
      })
      .finally(() => {
        document.documentElement.dataset.translyOptionsReady = "true";
      });
    return () => { active = false; };
  }, [connectLaneProvider, showStatus, updateModelChoices]);

  function resetModelChoices() {
    setModels([]);
    setModel("");
    setCustomModel("");
    setManualModel(false);
    setShowSaveWithoutTest(false);
  }

  async function requestModels(nextConnection = connection) {
    const response = await sendRuntimeMessage<any>({
      type: "TRANSLY_LIST_PROVIDER_MODELS",
      payload: nextConnection
    });
    return response.ok
      ? { ok: true as const, models: response.data?.models || [] }
      : { ok: false as const, error: response.error || "Could not connect to this service." };
  }

  async function refreshModels({ quiet = false } = {}) {
    if (!apiUrl.trim()) return;
    setBusy("models");
    if (!quiet) showStatus("Loading available models…");
    const result = await requestModels();
    setBusy("");
    if (!result.ok) {
      if (!quiet) {
        setManualModel(true);
        setShowSaveWithoutTest(true);
        showStatus(result.error, "error");
      }
      return;
    }
    updateModelChoices(result.models, selectedModel);
    if (!quiet) {
      showStatus(result.models.length
        ? `Loaded ${result.models.length} available model${result.models.length === 1 ? "" : "s"}.`
        : "Connected, but this service did not return a model list.", result.models.length ? "success" : "neutral");
    }
  }

  async function saveConfiguration(verified: boolean, modelOverride = selectedModel) {
    showStatus(verified ? "Saving translation service…" : "Saving without connection verification…");
    const response = await sendRuntimeMessage({
      type: "TRANSLY_SAVE_PROVIDER_SETTINGS",
      payload: { ...connection, model: modelOverride }
    });
    if (!response.ok) {
      showStatus(response.error || "Could not save settings.", "error");
      return false;
    }
    setSavedConfiguration(true);
    setShowSaveWithoutTest(false);
    showStatus(verified ? "Translation service connected." : "Translation service saved without testing.", "success");
    return true;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!apiUrl.trim()) return;
    setBusy("connect");
    setShowSaveWithoutTest(false);
    showStatus("Connecting to the translation service…");
    const result = await requestModels();
    if (!result.ok) {
      setManualModel(true);
      setBusy("");
      setShowSaveWithoutTest(true);
      showStatus(result.error, "error");
      return;
    }
    const nextModels = normalizeModels(result.models);
    const nextModel = selectedModel || chooseDefaultModel(nextModels);
    updateModelChoices(nextModels, nextModel);
    if (!nextModel) {
      setBusy("");
      setManualModel(true);
      showStatus("No model was listed. Enter the model name, then connect again.", "error");
      return;
    }
    await saveConfiguration(true, nextModel);
    setBusy("");
  }

  async function testConnection() {
    if (!selectedModel) {
      showStatus("Choose a model before testing the connection.", "error");
      return;
    }
    setBusy("test");
    showStatus("Testing the translation service…");
    const response = await sendRuntimeMessage<any>({
      type: "TRANSLY_TEST_PROVIDER",
      payload: { ...connection, model: selectedModel }
    });
    setBusy("");
    if (!response.ok) {
      showStatus(response.error || "Could not connect to this service.", "error");
      return;
    }
    if (response.data?.modelAvailable === false) {
      showStatus(`Connected, but ${selectedModel} is not available from this service.`, "error");
      return;
    }
    showStatus(response.data?.modelCount
      ? "Connection successful. The selected model is available."
      : "Connection successful. This service does not expose a model list.", "success");
  }

  async function discoverLocalProviders() {
    setDiscoveryOpen(true);
    setDiscoveryBusy(true);
    setDiscoveryLabel("Searching…");
    setDiscoveryResults([]);
    const response = await sendRuntimeMessage<LocalProvider[]>({ type: "TRANSLY_DISCOVER_LOCAL_PROVIDERS" });
    setDiscoveryBusy(false);
    if (!response.ok) {
      setDiscoveryLabel("Search failed");
      showStatus(response.error || "Could not search for local services.", "error");
      return;
    }
    const results = response.data || [];
    setDiscoveryResults(results);
    setDiscoveryLabel(results.length ? `${results.length} found` : "None found");
  }

  function chooseLocalProvider(result: LocalProvider) {
    setApiUrl(result.apiUrl);
    setApiKey("");
    setProtocol("auto");
    updateModelChoices(result.models || []);
    showStatus(result.authRequired
      ? "Local service selected. Enter its API key, then connect."
      : "Local service selected. Confirm the model, then connect.", result.authRequired ? "neutral" : "success");
  }

  function useOpenAI() {
    setApiUrl("https://api.openai.com/v1");
    setApiKey("");
    setProtocol("auto");
    resetModelChoices();
    showStatus("OpenAI API selected. Add your API key, then connect.");
  }

  const modelHint = models.length
    ? `${models.length} available model${models.length === 1 ? "" : "s"}. Choose one from the list.`
    : manualModel
      ? "Enter the provider model name exactly as the service exposes it."
      : "Load models to choose from those available to this service.";

  return (
    <main className="settings-shell">
      <section className="quick-setup" aria-labelledby="quickSetupHeading">
        <div className="section-heading">
          <h2 id="quickSetupHeading">Quick setup</h2>
          <p>Use Lane, find another local service, or connect the OpenAI API.</p>
        </div>
        <div className="quick-actions">
          <button id="connectLane" className="setup-action setup-action-primary" type="button" disabled={laneBusy} onClick={() => connectLaneProvider()}>
            <strong>{laneBusy ? "Connecting Lane…" : "Connect Lane"}</strong>
            <span>Use local AI providers automatically</span>
          </button>
          <button id="discoverLocal" className="setup-action" type="button" disabled={discoveryBusy} onClick={discoverLocalProviders}>
            <strong>Find local services</strong>
            <span>Check common compatible ports</span>
          </button>
          <button id="useOpenAI" className="setup-action" type="button" onClick={useOpenAI}>
            <strong>Use OpenAI API</strong>
            <span>Start with the official endpoint</span>
          </button>
        </div>

        {discoveryOpen && (
          <div id="discoveryPanel" className="discovery-panel">
            <div className="discovery-heading"><strong>Local services</strong><span id="discoveryStatus">{discoveryLabel}</span></div>
            <div id="localResults" className="local-results">
              {!discoveryBusy && !discoveryResults.length && <p className="discovery-empty">No compatible service was found on the common local ports.</p>}
              {discoveryResults.map((result) => (
                <button className="local-result" type="button" key={result.apiUrl} onClick={() => chooseLocalProvider(result)}>
                  <span className="local-result-copy"><strong>{result.hint || "Local API"}</strong><span>{result.apiUrl}</span></span>
                  <span className="local-result-detail">{result.authRequired ? "API key required" : `${result.models?.length || 0} models`}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <form id="providerForm" className="provider-form" onSubmit={submit}>
        <label className="field" htmlFor="apiUrl">
          <span>API URL</span>
          <input id="apiUrl" name="apiUrl" type="url" spellCheck={false} autoComplete="url" placeholder="https://api.openai.com/v1" required value={apiUrl} onChange={(event) => { setApiUrl(event.target.value); resetModelChoices(); }} />
          <small>Enter a base URL or a complete Responses or Chat Completions endpoint.</small>
        </label>

        <label className="field" htmlFor="apiKey">
          <span>API key</span>
          <span className="password-input">
            <input id="apiKey" name="apiKey" type={showKey ? "text" : "password"} spellCheck={false} autoComplete="off" placeholder="Optional" value={apiKey} onChange={(event) => { setApiKey(event.target.value); resetModelChoices(); }} />
            <button id="toggleApiKey" type="button" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey((value) => !value)}>
              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
          <small>Leave empty only when the service requires no key. Stored in Chrome local storage.</small>
        </label>

        <div className="field">
          <label id="modelLabel">Model</label>
          <div className="model-input-row">
            <Combobox.Root
              items={models}
              value={manualModel ? null : model || null}
              onValueChange={(value) => {
                if (!value) return;
                setManualModel(false);
                setModel(value);
                setCustomModel("");
              }}
              disabled={!models.length}
            >
              <Combobox.Trigger id="modelTrigger" className="model-trigger" aria-labelledby="modelLabel">
                <span id="modelValue" className={!selectedModel ? "is-placeholder" : ""}>
                  {selectedModel ? splitModelName(selectedModel).name : models.length ? "Choose a model" : "Connect to load available models"}
                </span>
                <Combobox.Icon className="control-icon"><ChevronDown size={17} /></Combobox.Icon>
              </Combobox.Trigger>
              <Combobox.Portal>
                <Combobox.Positioner className="combobox-positioner" align="start" sideOffset={6}>
                  <Combobox.Popup id="modelPopover" className="combobox-popup">
                    <div className="combobox-search">
                      <Search size={16} />
                      <Combobox.Input id="modelSearch" aria-label="Search available models" placeholder="Search models" />
                    </div>
                    <Combobox.List id="modelList" className="combobox-list">
                      {models.map((value) => {
                        const parts = splitModelName(value);
                        return (
                          <Combobox.Item className="model-option" data-value={value} key={value} value={value}>
                            <span className="model-option-copy">
                              <span className="model-option-name">{parts.name}</span>
                              {parts.provider && <span className="model-option-provider">{parts.provider}</span>}
                            </span>
                            <Combobox.ItemIndicator className="model-option-check"><Check size={16} /></Combobox.ItemIndicator>
                          </Combobox.Item>
                        );
                      })}
                    </Combobox.List>
                    <Combobox.Empty className="model-empty">No matching models</Combobox.Empty>
                    <button id="manualModel" className="model-manual" type="button" onClick={() => setManualModel(true)}>Enter a model name manually…</button>
                  </Combobox.Popup>
                </Combobox.Positioner>
              </Combobox.Portal>
            </Combobox.Root>
            <button id="loadModels" className="inline-action" type="button" disabled={Boolean(busy)} onClick={() => refreshModels()}>
              {busy === "models" ? <><LoaderCircle className="spin" size={16} /> Loading</> : "Load models"}
            </button>
          </div>
          {manualModel && <input id="customModel" className="custom-model" type="text" spellCheck={false} autoComplete="off" placeholder="Provider model name" value={customModel} onChange={(event) => setCustomModel(event.target.value)} />}
          <small id="modelHint">{modelHint}</small>
        </div>

        <details className="advanced-settings">
          <summary>Advanced</summary>
          <div className="field compact">
            <span>API format</span>
            <Select.Root items={PROTOCOLS} value={protocol} onValueChange={(value) => { if (value) { setProtocol(value as Protocol); resetModelChoices(); } }}>
              <Select.Trigger id="protocol" className="protocol-trigger" aria-label="API format">
                <Select.Value />
                <Select.Icon className="control-icon"><ChevronDown size={17} /></Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Positioner className="combobox-positioner" align="start" sideOffset={5}>
                  <Select.Popup className="protocol-popup">
                    <Select.List className="protocol-list">
                      {PROTOCOLS.map((item) => (
                        <Select.Item className="protocol-option" key={item.value} value={item.value}>
                          <Select.ItemIndicator><Check size={15} /></Select.ItemIndicator>
                          <Select.ItemText>{item.label}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.List>
                  </Select.Popup>
                </Select.Positioner>
              </Select.Portal>
            </Select.Root>
          </div>
        </details>

        <div className="form-footer">
          <p id="providerStatus" className="provider-status" data-tone={statusTone} role="status" aria-live="polite">{status}</p>
          <div className="form-actions">
            {showSaveWithoutTest && <button id="saveWithoutTest" className="secondary-action" type="button" disabled={Boolean(busy)} onClick={async () => { setBusy("connect"); await saveConfiguration(false); setBusy(""); }}>Save without testing</button>}
            <button id="testProvider" className="secondary-action" type="button" disabled={Boolean(busy)} onClick={testConnection}>{busy === "test" ? "Testing…" : "Test connection"}</button>
            <button id="connectProvider" className="primary-action" type="submit" disabled={Boolean(busy)}>{busy === "connect" ? "Connecting…" : savedConfiguration ? "Save changes" : "Connect"}</button>
          </div>
        </div>
      </form>
    </main>
  );
}

function normalizeModels(values: unknown[]) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function chooseDefaultModel(models: string[]) {
  const nonTextPattern = /(embedding|whisper|tts|speech|audio|image|dall-e|moderation|realtime|transcrib)/i;
  return models.find((name) => !nonTextPattern.test(name)) || models[0] || "";
}
