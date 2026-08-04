import {
  providerSummary,
  readProviderConfig,
  validateProviderConnection,
  validateProviderConfig,
  writeProviderConfig
} from "./provider/provider-config.js";
import { listProviderModels, testProvider } from "./provider/openai-compatible.js";
import { discoverLocalProviders } from "./provider/local-provider-discovery.js";
import { connectLane } from "./provider/lane-native.js";
import { createTranslationService } from "./provider/translation-service.js";

const DEFAULT_SETTINGS = Object.freeze({
  targetLanguage: "zh-CN",
  articleDisplayMode: "bilingual",
  articleBatchChars: 28000,
  articleBatchMaxItems: 28,
  articleContextChars: 36000,
  enableArticleAuditLoop: true,
  articleAuditMaxBlocks: 60,
  articleAuditMaxRepairItems: 20,
  subtitleEnabled: false,
  subtitleDisplayMode: "bilingual",
  subtitleLanguageOrder: "source-first",
  subtitleSourceFontSizePx: 25,
  subtitleTranslationFontSizePx: 30,
  subtitlePositionPercent: 6,
  subtitleBackgroundOpacity: 0.76,
  subtitleBatchChars: 1200,
  subtitleBatchMaxItems: 12
});
const PROVIDER_STATUS_TIMEOUT_MS = 3_000;

export function registerBackground(chromeApi, dependencies = {}) {
  const service = dependencies.service || createTranslationService();
  const checkProvider = dependencies.testProvider || testProvider;
  const listModels = dependencies.listProviderModels || listProviderModels;
  const discoverProviders = dependencies.discoverLocalProviders || discoverLocalProviders;
  const connectLaneProvider = dependencies.connectLane || (() => connectLane(chromeApi));

  Promise.resolve(chromeApi.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })).catch(() => {
    // Chrome 105+ supports this. Request handling still validates every caller.
  });

  chromeApi.runtime.onInstalled?.addListener((details) => {
    if (details.reason === "install") chromeApi.runtime.openOptionsPage();
  });

  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chromeApi.runtime.id) return false;

    if (message?.type === "TRANSLY_PROVIDER_STATUS") {
      readProviderConfig(chromeApi.storage.local)
        .then(async (config) => {
          if (!providerSummary(config).configured) {
            try {
              const lane = await connectLaneProvider();
              config = await writeProviderConfig(chromeApi.storage.local, lane.config);
            } catch {
              return providerSummary(config);
            }
          }
          const summary = providerSummary(config);
          try {
            await checkProvider(validateProviderConfig(config), {
              timeoutMs: PROVIDER_STATUS_TIMEOUT_MS
            });
            return { ...summary, available: true };
          } catch (error) {
            return { ...summary, available: false, error: formatError(error) };
          }
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_GET_PROVIDER_SETTINGS") {
      if (!isOptionsPage(chromeApi, sender)) return false;
      readProviderConfig(chromeApi.storage.local)
        .then((config) => sendResponse({ ok: true, data: config }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_SAVE_PROVIDER_SETTINGS") {
      if (!isOptionsPage(chromeApi, sender)) return false;
      writeProviderConfig(chromeApi.storage.local, message.payload)
        .then((config) => sendResponse({ ok: true, data: providerSummary(config) }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_TEST_PROVIDER") {
      if (!isOptionsPage(chromeApi, sender)) return false;
      Promise.resolve()
        .then(() => validateProviderConfig(message.payload))
        .then((config) => checkProvider(config))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_LIST_PROVIDER_MODELS") {
      if (!isOptionsPage(chromeApi, sender)) return false;
      Promise.resolve()
        .then(() => validateProviderConnection(message.payload))
        .then((config) => listModels(config))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_LIST_CONFIGURED_MODELS") {
      if (!isExtensionPage(chromeApi, sender)) return false;
      readProviderConfig(chromeApi.storage.local)
        .then(async (config) => {
          const validConfig = validateProviderConfig(config);
          const data = await listModels(validConfig);
          return {
            models: data.models || [],
            currentModel: validConfig.model,
            summary: providerSummary(validConfig)
          };
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_SELECT_PROVIDER_MODEL") {
      if (!isExtensionPage(chromeApi, sender)) return false;
      const nextModel = String(message.model || "").trim();
      if (!nextModel) {
        sendResponse({ ok: false, error: "Model name is required." });
        return false;
      }
      readProviderConfig(chromeApi.storage.local)
        .then((config) => writeProviderConfig(chromeApi.storage.local, {
          ...config,
          model: nextModel
        }))
        .then((config) => sendResponse({ ok: true, data: providerSummary(config) }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_DISCOVER_LOCAL_PROVIDERS") {
      if (!isOptionsPage(chromeApi, sender)) return false;
      Promise.resolve(discoverProviders())
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_CONNECT_LANE") {
      if (!isExtensionPage(chromeApi, sender)) return false;
      Promise.resolve()
        .then(() => connectLaneProvider())
        .then(async (lane) => {
          const config = await writeProviderConfig(chromeApi.storage.local, lane.config);
          return {
            config,
            models: lane.models,
            summary: providerSummary(config)
          };
        })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_TRANSLATE") {
      withProviderConfig(chromeApi, (config) => service.translate(message.payload, {
        config,
        onProgress(data) {
          relayTranslationProgress(chromeApi, sender, data);
        }
      }))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_AUDIT_ARTICLE") {
      withProviderConfig(chromeApi, (config) => service.audit(message.payload, { config }))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: formatError(error) }));
      return true;
    }

    if (message?.type === "TRANSLY_GET_SETTINGS") {
      chromeApi.storage.sync.get(null, (storedSettings) => {
        const error = chromeApi.runtime.lastError;
        const settings = normalizeSettings(storedSettings);
        const migratedFontSizes = {};
        if (storedSettings?.subtitleSourceFontSizePx === undefined && storedSettings?.subtitleSourceFontScale !== undefined) {
          migratedFontSizes.subtitleSourceFontSizePx = settings.subtitleSourceFontSizePx;
        }
        if (
          storedSettings?.subtitleTranslationFontSizePx === undefined
          && storedSettings?.subtitleTranslationFontScale !== undefined
        ) {
          migratedFontSizes.subtitleTranslationFontSizePx = settings.subtitleTranslationFontSizePx;
        }
        if (!error && Object.keys(migratedFontSizes).length) chromeApi.storage.sync.set(migratedFontSizes);
        sendResponse(error
          ? { ok: false, error: error.message }
          : { ok: true, data: settings });
      });
      return true;
    }

    if (message?.type === "TRANSLY_SAVE_SETTINGS") {
      chromeApi.storage.sync.set(message.payload || {}, () => {
        const error = chromeApi.runtime.lastError;
        sendResponse(error ? { ok: false, error: error.message } : { ok: true });
      });
      return true;
    }

    return false;
  });
}

export function normalizeSettings(storedSettings = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...storedSettings };
  if (storedSettings.subtitleSourceFontSizePx === undefined && storedSettings.subtitleSourceFontScale !== undefined) {
    settings.subtitleSourceFontSizePx = legacySubtitleFontSize(storedSettings.subtitleSourceFontScale);
  }
  if (
    storedSettings.subtitleTranslationFontSizePx === undefined
    && storedSettings.subtitleTranslationFontScale !== undefined
  ) {
    settings.subtitleTranslationFontSizePx = legacySubtitleFontSize(storedSettings.subtitleTranslationFontScale);
  }
  return settings;
}

function legacySubtitleFontSize(scale) {
  const pixelSize = Math.round(Number(scale) * 30);
  return Number.isFinite(pixelSize) ? Math.min(56, Math.max(14, pixelSize)) : 30;
}

async function withProviderConfig(chromeApi, operation) {
  const stored = await readProviderConfig(chromeApi.storage.local);
  const config = validateProviderConfig(stored);
  return operation(config);
}

function relayTranslationProgress(chromeApi, sender, data) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || !data || typeof data !== "object") return;
  const message = { type: "TRANSLY_TRANSLATION_PROGRESS", data };
  const callback = () => void chromeApi.runtime.lastError;
  if (Number.isInteger(sender.frameId)) {
    chromeApi.tabs.sendMessage(tabId, message, { frameId: sender.frameId }, callback);
  } else {
    chromeApi.tabs.sendMessage(tabId, message, callback);
  }
}

function isOptionsPage(chromeApi, sender) {
  return sender.url?.startsWith(chromeApi.runtime.getURL("options.html"));
}

function isExtensionPage(chromeApi, sender) {
  return sender.url?.startsWith(chromeApi.runtime.getURL(""));
}

function formatError(error) {
  const code = error?.code ? `[${error.code}] ` : "";
  return `${code}${String(error?.message || error)}`;
}
