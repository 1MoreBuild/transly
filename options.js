const form = document.querySelector("#providerForm");
const apiUrl = document.querySelector("#apiUrl");
const apiKey = document.querySelector("#apiKey");
const model = document.querySelector("#model");
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
    model.focus();
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
    model.focus();
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
    model.focus();
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
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = availableModels.length ? "Choose a model" : "No model list available";
  const options = availableModels.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  });
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "Enter a model name manually…";
  model.replaceChildren(placeholder, ...options, custom);
  model.disabled = false;
  if (current && availableModels.includes(current)) {
    selectModel(current);
  } else if (current) {
    selectModel(current);
  }
  modelHint.textContent = availableModels.length
    ? `${availableModels.length} available model${availableModels.length === 1 ? "" : "s"}. Choose one from the list.`
    : "No model list is available. Choose the manual option and enter the provider model name.";
}

function resetModelChoices() {
  availableModels = [];
  model.replaceChildren(new Option("Connect to load available models", ""));
  model.disabled = true;
  customModel.hidden = true;
  customModel.value = "";
  modelHint.textContent = "Load models to choose from those available to this service.";
  saveWithoutTest.hidden = true;
}

function enableManualModelEntry() {
  if (!model.querySelector('option[value="__custom__"]')) {
    const custom = new Option("Enter a model name manually…", "__custom__");
    model.append(custom);
  }
  model.disabled = false;
  model.value = "__custom__";
  customModel.hidden = false;
}

function chooseDefaultModel(models) {
  const nonTextPattern = /(embedding|whisper|tts|speech|audio|image|dall-e|moderation|realtime|transcrib)/i;
  return models.find((name) => !nonTextPattern.test(name)) || models[0] || "";
}

model.addEventListener("change", () => {
  const custom = model.value === "__custom__";
  customModel.hidden = !custom;
  if (custom) customModel.focus();
});

function showSavedModel(value) {
  if (!value) return;
  const option = new Option(value, value, true, true);
  model.replaceChildren(option);
  model.disabled = false;
}

function selectModel(value) {
  if (!value) {
    model.value = "";
    customModel.hidden = true;
    return;
  }
  if (availableModels.includes(value)) {
    model.value = value;
    customModel.hidden = true;
    customModel.value = "";
    return;
  }
  model.value = "__custom__";
  customModel.hidden = false;
  customModel.value = value;
}

function selectedModel() {
  return model.value === "__custom__" ? customModel.value.trim() : model.value.trim();
}

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
