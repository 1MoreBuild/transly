const form = document.querySelector("#providerForm");
const apiUrl = document.querySelector("#apiUrl");
const apiKey = document.querySelector("#apiKey");
const model = document.querySelector("#model");
const modelPicker = document.querySelector("#modelPicker");
const modelTrigger = document.querySelector("#modelTrigger");
const modelValue = document.querySelector("#modelValue");
const modelPopover = document.querySelector("#modelPopover");
const modelSearch = document.querySelector("#modelSearch");
const modelList = document.querySelector("#modelList");
const manualModel = document.querySelector("#manualModel");
const customModel = document.querySelector("#customModel");
const modelHint = document.querySelector("#modelHint");
const protocol = document.querySelector("#protocol");
const toggleApiKey = document.querySelector("#toggleApiKey");
const connectLane = document.querySelector("#connectLane");
const discoverLocal = document.querySelector("#discoverLocal");
const useOpenAI = document.querySelector("#useOpenAI");
const discoveryPanel = document.querySelector("#discoveryPanel");
const discoveryStatus = document.querySelector("#discoveryStatus");
const localResults = document.querySelector("#localResults");
const loadModels = document.querySelector("#loadModels");
const connectButton = document.querySelector("#connectProvider");
const saveWithoutTest = document.querySelector("#saveWithoutTest");
const status = document.querySelector("#providerStatus");

let availableModels = [];
let savedConfiguration = false;
let savedModel = "";
let filteredModels = [];
let activeModelIndex = -1;

initialize();

async function initialize() {
  const response = await sendMessage({ type: "TRANSLY_GET_PROVIDER_SETTINGS" });
  if (!response?.ok) {
    showStatus(response?.error || "Could not load settings.", "error");
    return;
  }
  apiUrl.value = response.data.apiUrl || "";
  apiKey.value = response.data.apiKey || "";
  savedModel = response.data.model || "";
  showSavedModel(savedModel);
  protocol.value = response.data.protocol || "auto";
  savedConfiguration = Boolean(response.data.apiUrl && response.data.model);
  connectButton.textContent = savedConfiguration ? "Save changes" : "Connect";
  if (response.data.apiUrl) {
    refreshModels({ quiet: true });
  } else {
    await connectLaneProvider({ quiet: true });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!apiUrl.reportValidity()) return;
  setBusy(true);
  saveWithoutTest.hidden = true;
  showStatus("Connecting to the translation service…");

  const result = await requestModels();
  if (!result.ok) {
    enableManualModelEntry();
    setBusy(false);
    saveWithoutTest.hidden = false;
    showStatus(result.error, "error");
    return;
  }

  updateModelChoices(result.models);
  if (!selectedModel()) selectModel(chooseDefaultModel(result.models));
  if (!selectedModel()) {
    setBusy(false);
    showStatus("No model was listed. Enter the model name, then connect again.", "error");
    focusModelControl();
    return;
  }

  await saveConfiguration({ verified: true });
  setBusy(false);
});

loadModels.addEventListener("click", async () => {
  if (!apiUrl.reportValidity()) return;
  await refreshModels();
});

connectLane.addEventListener("click", () => connectLaneProvider());

discoverLocal.addEventListener("click", async () => {
  discoveryPanel.hidden = false;
  localResults.replaceChildren();
  discoverLocal.disabled = true;
  discoveryStatus.textContent = "Searching…";
  const response = await sendMessage({ type: "TRANSLY_DISCOVER_LOCAL_PROVIDERS" });
  discoverLocal.disabled = false;

  if (!response?.ok) {
    discoveryStatus.textContent = "Search failed";
    showStatus(response?.error || "Could not search for local services.", "error");
    return;
  }
  renderLocalResults(response.data || []);
});

useOpenAI.addEventListener("click", () => {
  selectEndpoint("https://api.openai.com/v1");
  showStatus("OpenAI API selected. Add your API key, then connect.");
  apiKey.focus();
});

saveWithoutTest.addEventListener("click", async () => {
  if (!apiUrl.reportValidity()) return;
  if (!selectedModel()) {
    showStatus("Enter a model name before saving.", "error");
    focusModelControl();
    return;
  }
  setBusy(true);
  await saveConfiguration({ verified: false });
  setBusy(false);
});

toggleApiKey.addEventListener("click", () => {
  const visible = apiKey.type === "text";
  apiKey.type = visible ? "password" : "text";
  toggleApiKey.textContent = visible ? "Show" : "Hide";
  toggleApiKey.setAttribute("aria-label", visible ? "Show API key" : "Hide API key");
});

apiUrl.addEventListener("change", resetModelChoices);
apiKey.addEventListener("change", resetModelChoices);
protocol.addEventListener("change", resetModelChoices);

async function refreshModels({ quiet = false } = {}) {
  if (!apiUrl.value.trim()) return;
  loadModels.disabled = true;
  loadModels.textContent = "Loading…";
  if (!quiet) showStatus("Loading available models…");
  const result = await requestModels();
  loadModels.disabled = false;
  loadModels.textContent = "Load models";

  if (!result.ok) {
    if (!quiet) {
      enableManualModelEntry();
      saveWithoutTest.hidden = false;
      showStatus(result.error, "error");
    }
    return;
  }

  updateModelChoices(result.models);
  if (!selectedModel()) selectModel(chooseDefaultModel(result.models));
  if (!quiet) {
    showStatus(result.models.length
      ? `Loaded ${result.models.length} available model${result.models.length === 1 ? "" : "s"}.`
      : "Connected, but this service did not return a model list.", result.models.length ? "success" : "neutral");
  }
}

async function requestModels() {
  const response = await sendMessage({
    type: "TRANSLY_LIST_PROVIDER_MODELS",
    payload: connectionValue()
  });
  return response?.ok
    ? { ok: true, models: response.data.models || [] }
    : { ok: false, error: response?.error || "Could not connect to this service." };
}

function renderLocalResults(results) {
  localResults.replaceChildren();
  if (!results.length) {
    discoveryStatus.textContent = "None found";
    const empty = document.createElement("p");
    empty.className = "discovery-empty";
    empty.textContent = "No compatible service was found on the common local ports.";
    localResults.append(empty);
    return;
  }

  discoveryStatus.textContent = `${results.length} found`;
  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "local-result";

    const copy = document.createElement("span");
    copy.className = "local-result-copy";
    const title = document.createElement("strong");
    title.textContent = result.hint || "Local API";
    const endpoint = document.createElement("span");
    endpoint.textContent = result.apiUrl;
    copy.append(title, endpoint);

    const detail = document.createElement("span");
    detail.className = "local-result-detail";
    detail.textContent = result.authRequired
      ? "API key required"
      : `${result.models.length} model${result.models.length === 1 ? "" : "s"}`;
    button.append(copy, detail);
    button.addEventListener("click", () => chooseLocalResult(result));
    localResults.append(button);
  }
}

function chooseLocalResult(result) {
  selectEndpoint(result.apiUrl);
  updateModelChoices(result.models || []);
  selectModel(chooseDefaultModel(result.models || []));
  if (result.authRequired) {
    showStatus("Local service selected. Enter its API key, then connect.");
    apiKey.focus();
  } else {
    showStatus("Local service selected. Confirm the model, then connect.", "success");
    focusModelControl();
  }
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function connectLaneProvider({ quiet = false } = {}) {
  connectLane.disabled = true;
  const original = connectLane.querySelector("strong").textContent;
  connectLane.querySelector("strong").textContent = "Connecting Lane…";
  if (!quiet) showStatus("Connecting to Lane…");
  const response = await sendMessage({ type: "TRANSLY_CONNECT_LANE" });
  connectLane.disabled = false;
  connectLane.querySelector("strong").textContent = original;
  if (!response?.ok) {
    if (!quiet) showStatus(response?.error || "Lane is not available.", "error");
    return false;
  }
  const config = response.data.config;
  apiUrl.value = config.apiUrl;
  apiKey.value = config.apiKey;
  protocol.value = config.protocol;
  savedModel = config.model;
  updateModelChoices(response.data.models || []);
  selectModel(config.model);
  savedConfiguration = true;
  connectButton.textContent = "Save changes";
  showStatus(`Connected to Lane with ${config.model}.`, "success");
  return true;
}

function selectEndpoint(value) {
  if (apiUrl.value !== value) {
    apiUrl.value = value;
    apiKey.value = "";
    savedModel = "";
    protocol.value = "auto";
    resetModelChoices();
  }
}

function updateModelChoices(models) {
  availableModels = [...new Set(models.map((value) => String(value).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const current = selectedModel() || savedModel;
  setModelPickerDisabled(false);
  if (current && availableModels.includes(current)) {
    selectModel(current);
  } else if (current) {
    selectModel(current);
  } else {
    selectModel("");
  }
  renderModelChoices();
  modelHint.textContent = availableModels.length
    ? `${availableModels.length} available model${availableModels.length === 1 ? "" : "s"}. Choose one from the list.`
    : "No model list is available. Choose the manual option and enter the provider model name.";
}

function resetModelChoices() {
  availableModels = [];
  filteredModels = [];
  model.value = "";
  setModelPickerDisabled(true);
  closeModelPicker();
  setModelTriggerValue("Connect to load available models", true);
  modelList.replaceChildren();
  customModel.hidden = true;
  customModel.value = "";
  modelHint.textContent = "Load models to choose from those available to this service.";
  saveWithoutTest.hidden = true;
}

function enableManualModelEntry() {
  setModelPickerDisabled(false);
  model.value = "__custom__";
  customModel.hidden = false;
  setModelTriggerValue(customModel.value || "Custom model", !customModel.value);
  closeModelPicker();
  customModel.focus();
}

function chooseDefaultModel(models) {
  const nonTextPattern = /(embedding|whisper|tts|speech|audio|image|dall-e|moderation|realtime|transcrib)/i;
  return models.find((name) => !nonTextPattern.test(name)) || models[0] || "";
}

function showSavedModel(value) {
  if (!value) return;
  availableModels = [value];
  setModelPickerDisabled(false);
  selectModel(value);
  renderModelChoices();
}

function selectModel(value) {
  if (!value) {
    model.value = "";
    customModel.hidden = true;
    customModel.value = "";
    setModelTriggerValue(availableModels.length ? "Choose a model" : "No model list available", true);
    renderModelChoices(modelSearch.value);
    return;
  }
  if (availableModels.includes(value)) {
    model.value = value;
    customModel.hidden = true;
    customModel.value = "";
    setModelTriggerValue(value);
    renderModelChoices(modelSearch.value);
    closeModelPicker();
    return;
  }
  model.value = "__custom__";
  customModel.hidden = false;
  customModel.value = value;
  setModelTriggerValue(value);
  renderModelChoices(modelSearch.value);
  closeModelPicker();
}

function selectedModel() {
  return model.value === "__custom__" ? customModel.value.trim() : model.value.trim();
}

function setModelPickerDisabled(disabled) {
  modelPicker.dataset.disabled = String(disabled);
  modelTrigger.disabled = disabled;
}

function setModelTriggerValue(value, placeholder = false) {
  modelValue.textContent = value;
  modelValue.title = placeholder ? "" : value;
  modelValue.classList.toggle("is-placeholder", placeholder);
}

function openModelPicker() {
  if (modelTrigger.disabled) return;
  modelPopover.hidden = false;
  modelTrigger.setAttribute("aria-expanded", "true");
  modelSearch.value = "";
  renderModelChoices();
  requestAnimationFrame(() => modelSearch.focus());
}

function closeModelPicker({ restoreFocus = false } = {}) {
  modelPopover.hidden = true;
  modelTrigger.setAttribute("aria-expanded", "false");
  activeModelIndex = -1;
  if (restoreFocus) modelTrigger.focus();
}

function renderModelChoices(filter = "") {
  const query = filter.trim().toLocaleLowerCase();
  filteredModels = availableModels.filter((value) => value.toLocaleLowerCase().includes(query));
  modelList.replaceChildren();
  activeModelIndex = filteredModels.length ? 0 : -1;

  if (!filteredModels.length) {
    const empty = document.createElement("p");
    empty.className = "model-empty";
    empty.textContent = availableModels.length ? "No matching models" : "No models returned";
    modelList.append(empty);
    return;
  }

  filteredModels.forEach((value, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-option";
    button.dataset.value = value;
    button.dataset.active = String(index === activeModelIndex);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selectedModel() === value));

    const copy = document.createElement("span");
    copy.className = "model-option-copy";
    const name = document.createElement("span");
    name.className = "model-option-name";
    const provider = document.createElement("span");
    provider.className = "model-option-provider";
    const parts = splitModelName(value);
    name.textContent = parts.name;
    provider.textContent = parts.provider;
    provider.hidden = !parts.provider;
    copy.append(name, provider);

    const check = document.createElement("span");
    check.className = "model-option-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = selectedModel() === value ? "✓" : "";
    button.append(copy, check);
    button.addEventListener("pointermove", () => setActiveModelIndex(index));
    button.addEventListener("click", () => {
      selectModel(value);
      modelTrigger.focus();
    });
    modelList.append(button);
  });
}

function splitModelName(value) {
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1) return { name: value, provider: "" };
  return {
    name: value.slice(separator + 1),
    provider: value.slice(0, separator)
  };
}

function setActiveModelIndex(index) {
  if (!filteredModels.length) return;
  activeModelIndex = Math.max(0, Math.min(filteredModels.length - 1, index));
  [...modelList.querySelectorAll(".model-option")].forEach((option, optionIndex) => {
    option.dataset.active = String(optionIndex === activeModelIndex);
  });
}

function moveActiveModel(delta) {
  if (!filteredModels.length) return;
  const next = activeModelIndex < 0
    ? 0
    : (activeModelIndex + delta + filteredModels.length) % filteredModels.length;
  setActiveModelIndex(next);
  modelList.querySelectorAll(".model-option")[next]?.scrollIntoView({ block: "nearest" });
}

function focusModelControl() {
  if (!customModel.hidden) customModel.focus();
  else modelTrigger.focus();
}

modelTrigger.addEventListener("click", () => {
  if (modelPopover.hidden) openModelPicker();
  else closeModelPicker();
});

modelSearch.addEventListener("input", () => renderModelChoices(modelSearch.value));
modelSearch.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveActiveModel(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    setActiveModelIndex(event.key === "Home" ? 0 : filteredModels.length - 1);
  } else if (event.key === "Enter" && activeModelIndex >= 0) {
    event.preventDefault();
    selectModel(filteredModels[activeModelIndex]);
    modelTrigger.focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeModelPicker({ restoreFocus: true });
  }
});

manualModel.addEventListener("click", enableManualModelEntry);
customModel.addEventListener("input", () => {
  if (model.value === "__custom__") {
    setModelTriggerValue(customModel.value.trim() || "Custom model", !customModel.value.trim());
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!modelPopover.hidden && !modelPicker.contains(event.target)) closeModelPicker();
});

async function saveConfiguration({ verified }) {
  showStatus(verified ? "Saving translation service…" : "Saving without connection verification…");
  const response = await sendMessage({ type: "TRANSLY_SAVE_PROVIDER_SETTINGS", payload: formValue() });
  if (!response?.ok) {
    showStatus(response?.error || "Could not save settings.", "error");
    return;
  }
  savedConfiguration = true;
  savedModel = selectedModel();
  connectButton.textContent = "Save changes";
  saveWithoutTest.hidden = true;
  showStatus(verified ? "Translation service connected." : "Translation service saved without testing.", "success");
}

function connectionValue() {
  return {
    apiUrl: apiUrl.value,
    apiKey: apiKey.value,
    protocol: protocol.value
  };
}

function formValue() {
  return { ...connectionValue(), model: selectedModel() };
}

function setBusy(busy) {
  connectButton.disabled = busy;
  loadModels.disabled = busy;
  saveWithoutTest.disabled = busy;
  connectButton.textContent = busy ? "Connecting…" : savedConfiguration ? "Save changes" : "Connect";
}

function showStatus(message, tone = "neutral") {
  status.textContent = message;
  status.dataset.tone = tone;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(chrome.runtime.lastError
        ? { ok: false, error: chrome.runtime.lastError.message }
        : response);
    });
  });
}
