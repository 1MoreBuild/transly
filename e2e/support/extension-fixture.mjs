import { test as base, chromium } from "@playwright/test";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockProvider } from "./mock-provider.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSION_ROOT = path.join(
  REPOSITORY_ROOT,
  "dist",
  process.env.TRANSLY_E2E === "1" ? "extension-e2e" : "extension"
);

export const test = base.extend({
  provider: async ({}, use) => {
    const provider = await startMockProvider();
    await use(provider);
    await provider.close();
  },

  extension: async ({}, use, testInfo) => {
    const profileDir = testInfo.outputPath("chromium-profile");
    const videoDir = testInfo.outputPath("videos");
    const tracePaths = [];
    let launchIndex = 0;
    let context;
    let serviceWorker;
    let extensionId;

    async function launch() {
      launchIndex += 1;
      await mkdir(videoDir, { recursive: true });
      context = await chromium.launchPersistentContext(profileDir, {
        channel: "chromium",
        headless: true,
        viewport: { width: 1440, height: 1000 },
        recordVideo: {
          dir: videoDir,
          size: { width: 1280, height: 900 }
        },
        args: [
          `--disable-extensions-except=${EXTENSION_ROOT}`,
          `--load-extension=${EXTENSION_ROOT}`
        ]
      });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      [serviceWorker] = context.serviceWorkers();
      if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");
      extensionId = new URL(serviceWorker.url()).host;
      for (const page of context.pages()) await page.close();
    }

    async function stop({ keepTrace = false } = {}) {
      if (!context) return;
      const tracePath = testInfo.outputPath(`trace-${launchIndex}.zip`);
      await context.tracing.stop(keepTrace ? { path: tracePath } : undefined).catch(() => {});
      if (keepTrace) tracePaths.push(tracePath);
      await context.close();
      context = null;
      serviceWorker = null;
      extensionId = null;
    }

    await launch();
    const fixture = {
      get context() {
        return context;
      },
      get serviceWorker() {
        return serviceWorker;
      },
      get extensionId() {
        return extensionId;
      },
      async restart() {
        await stop({ keepTrace: true });
        await launch();
      }
    };

    await use(fixture);

    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed && context) {
      let index = 0;
      for (const page of context.pages()) {
        await page.screenshot({
          path: testInfo.outputPath(`failure-${++index}.png`),
          fullPage: true
        }).catch(() => {});
      }
    }
    await stop({ keepTrace: failed });
    if (!failed) {
      await Promise.all(tracePaths.map((tracePath) => rm(tracePath, { force: true })));
      await rm(videoDir, { recursive: true, force: true });
    } else {
      for (const tracePath of tracePaths) {
        await testInfo.attach(path.basename(tracePath), {
          path: tracePath,
          contentType: "application/zip"
        });
      }
      for (const file of await readdir(videoDir).catch(() => [])) {
        if (!file.endsWith(".webm")) continue;
        await testInfo.attach(file, {
          path: path.join(videoDir, file),
          contentType: "video/webm"
        });
      }
    }
  }
});

export const expect = test.expect;

export async function configureProvider(extension, provider, model = provider.models[0]) {
  const page = await extension.context.newPage();
  await page.goto(`chrome-extension://${extension.extensionId}/options.html`);
  await expect(page.locator("html")).toHaveAttribute("data-transly-options-ready", "true");
  await expect(page.locator("#connectLane")).toBeEnabled();
  await page.locator("#apiUrl").fill(provider.apiUrl);
  await page.locator("#apiKey").fill(provider.apiKey);
  await page.locator("#loadModels").click();
  await expect(page.locator("#modelTrigger")).toBeEnabled();
  await page.locator("#modelTrigger").click();
  await page.locator(`.model-option[data-value="${model}"]`).click();
  await page.locator("#connectProvider").click();
  await expect(page.locator("#providerStatus")).toHaveText(/connected/i);
  if (process.env.TRANSLY_OPTIONS_CAPTURE) {
    await page.screenshot({ path: process.env.TRANSLY_OPTIONS_CAPTURE, fullPage: true, animations: "disabled" });
  }
  await page.close();
}

export async function openArticle(extension, provider) {
  const page = await extension.context.newPage();
  await page.goto(provider.articleUrl);
  await expect(page.locator("article")).toBeVisible();
  const tabId = await waitForArticleContentScript(extension, provider.articleUrl);
  return { page, tabId };
}

export async function openSubtitlePage(extension, provider) {
  const page = await extension.context.newPage();
  await page.goto(provider.subtitleUrl);
  await expect(page.locator("video")).toBeVisible();
  const tabId = await waitForArticleContentScript(extension, provider.subtitleUrl);
  return { page, tabId };
}

export async function openSemanticSubtitlePage(extension, provider) {
  const page = await extension.context.newPage();
  await page.goto(provider.subtitleSemanticUrl);
  await expect(page.locator("video")).toBeVisible();
  const tabId = await waitForArticleContentScript(extension, provider.subtitleSemanticUrl);
  return { page, tabId };
}

export async function openTextTrackPage(extension, provider) {
  const page = await extension.context.newPage();
  await page.goto(provider.subtitleTrackUrl);
  await expect(page.locator("video")).toBeVisible();
  const tabId = await waitForArticleContentScript(extension, provider.subtitleTrackUrl);
  return { page, tabId };
}

export async function openTargetSubtitlePage(extension, provider) {
  const page = await extension.context.newPage();
  await page.goto(provider.subtitleTargetUrl);
  await expect(page.locator("video")).toBeVisible();
  const tabId = await waitForArticleContentScript(extension, provider.subtitleTargetUrl);
  return { page, tabId };
}

export async function openTriggeredSubtitlePage(extension, provider) {
  const page = await extension.context.newPage();
  await page.goto(provider.subtitleTriggerUrl);
  await expect(page.locator("video")).toBeVisible();
  const tabId = await waitForArticleContentScript(extension, provider.subtitleTriggerUrl);
  return { page, tabId };
}

export async function openLongSubtitlePage(extension, provider) {
  const page = await extension.context.newPage();
  await page.goto(provider.subtitleLongUrl);
  await expect(page.locator("video")).toBeVisible();
  const tabId = await waitForArticleContentScript(extension, provider.subtitleLongUrl);
  return { page, tabId };
}

export async function openSubtitlePreviewPage(extension, provider) {
  const page = await extension.context.newPage();
  await page.goto(provider.subtitlePreviewUrl);
  await expect(page.locator("video")).toBeVisible();
  const tabId = await waitForArticleContentScript(extension, provider.subtitlePreviewUrl);
  return { page, tabId };
}

export async function openDisabledTextTrackPage(extension, provider) {
  const page = await extension.context.newPage();
  await page.goto(provider.subtitleDisabledTrackUrl);
  await expect(page.locator("video")).toBeVisible();
  const tabId = await waitForArticleContentScript(extension, provider.subtitleDisabledTrackUrl);
  return { page, tabId };
}

export async function openPopup(extension, tabId) {
  const page = await extension.context.newPage();
  await page.goto(`chrome-extension://${extension.extensionId}/popup.html?tabId=${tabId}`);
  await expect(page.locator("#providerState")).not.toHaveText("Checking");
  return page;
}

async function waitForArticleContentScript(extension, articleUrl) {
  return expect.poll(async () => {
    return extension.serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      const tab = tabs[0];
      if (!tab?.id) return 0;
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "TRANSLY_GET_PAGE_STATE" });
        return response?.ok ? tab.id : 0;
      } catch {
        return 0;
      }
    }, articleUrl);
  }).not.toBe(0).then(async () => {
    return extension.serviceWorker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return tabs[0]?.id || 0;
    }, articleUrl);
  });
}
