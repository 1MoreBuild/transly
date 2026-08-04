import {
  configureProvider,
  expect,
  openDisabledTextTrackPage,
  openArticle,
  openSemanticSubtitlePage,
  openSubtitlePage,
  openTextTrackPage,
  openTriggeredSubtitlePage,
  openPopup,
  test
} from "./support/extension-fixture.mjs";

test("a viewer enables bilingual subtitles, follows playback, and keeps them across reloads", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openSubtitlePage(extension, provider);
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.readyState)).toBeGreaterThan(0);
  await videoPage.evaluate(() => window.setSubtitleTime(1));
  await videoPage.locator("#transly-subtitle-controls .toggle").click();
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitle-status", "ready");
  await expect(videoPage.locator("#transly-caption-window")).toContainText("First caption from the video.");
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");

  await videoPage.evaluate(() => window.setSubtitleTime(3.5));
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第二句字幕。");
  expect(provider.translationRequests()).toHaveLength(1);

  await videoPage.reload();
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitles-enabled", "true");
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  expect(provider.translationRequests()).toHaveLength(1);

  await videoPage.locator("#transly-subtitle-controls .toggle").click();
  await expect(videoPage.locator("#transly-caption-window")).toHaveCount(0);
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitles-enabled", "false");
});

test("subtitle translation keeps a complete utterance together and preserves timed cue order", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openSemanticSubtitlePage(extension, provider);

  await videoPage.locator("#transly-subtitle-controls .toggle").click();
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitle-status", "ready");

  const request = provider.translationRequests().at(-1);
  expect(request.prompt).toContain("SUBTITLE GROUP SIZES\n2");
  expect(request.prompt.indexOf("Welcome to the second annual Code with Claude conference,"))
    .toBeLessThan(request.prompt.indexOf("where builders share what they learned."));
  expect(request.instructions).toContain("understand each complete group as one utterance");
  expect(request.instructions).toContain("never move meaning across groups");
});

test("a viewer gets bilingual subtitles from a native TextTrack without a fetch hook", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openTextTrackPage(extension, provider);
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.readyState)).toBeGreaterThan(0);
  await videoPage.evaluate(() => window.setSubtitleTime(1));
  await videoPage.locator("#transly-subtitle-controls .toggle").click();
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitle-status", "ready");
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("hidden");

  await videoPage.locator("#transly-subtitle-controls .toggle").click();
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("showing");
});

test("enabling subtitles triggers a player caption request when captions start off", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openTriggeredSubtitlePage(extension, provider);
  await expect(videoPage.locator(".ytp-subtitles-button")).toHaveAttribute("aria-pressed", "false");
  await videoPage.evaluate(() => window.setSubtitleTime(1));

  await videoPage.locator("#transly-subtitle-controls .toggle").click();

  await expect(videoPage.locator(".ytp-subtitles-button")).toHaveAttribute("aria-pressed", "true");
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  expect(provider.translationRequests()).toHaveLength(1);
});

test("a viewer controls translated subtitles and their appearance inside the player", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openTriggeredSubtitlePage(extension, provider);
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.readyState)).toBeGreaterThan(0);
  await videoPage.evaluate(() => window.setSubtitleTime(1));

  const controls = videoPage.locator("#transly-subtitle-controls");
  await expect(controls).toHaveAttribute("data-placement", "floating");
  await expect(controls.locator(".toggle")).toHaveAttribute("aria-label", "Turn on translated subtitles");
  await expect(controls.locator(".brand-icon")).toHaveAttribute("src", /transly-player\.svg$/);
  await expect.poll(() => controls.evaluate((node) => node.parentElement === document.documentElement)).toBe(true);
  await expect.poll(() => videoPage.evaluate(() => {
    const controlsRect = document.querySelector("#transly-subtitle-controls").getBoundingClientRect();
    const youtubeControlsRect = document.querySelector(".ytp-right-controls").getBoundingClientRect();
    return {
      gap: Math.round(youtubeControlsRect.left - controlsRect.right),
      centerDelta: Math.round(Math.abs(
        (youtubeControlsRect.top + youtubeControlsRect.height / 2)
        - (controlsRect.top + controlsRect.height / 2)
      ))
    };
  })).toEqual({ gap: 8, centerDelta: 0 });
  await controls.locator(".toggle").click();

  await expect(videoPage.locator(".ytp-subtitles-button")).toHaveAttribute("aria-pressed", "true");
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect(controls).toHaveAttribute("data-state", "ready");
  await expect(controls.locator(".toggle")).toHaveAttribute("aria-label", "Turn off translated subtitles");

  const caption = videoPage.locator("#transly-caption-window");
  await expect.poll(() => videoPage.evaluate(() => {
    const videoRect = document.querySelector("video").getBoundingClientRect();
    const captionRect = document.querySelector("#transly-caption-window").getBoundingClientRect();
    return Math.round(videoRect.bottom - captionRect.bottom);
  })).toBe(32);
  await videoPage.locator(".html5-video-player").evaluate((node) => node.classList.remove("ytp-autohide"));
  await expect.poll(() => videoPage.evaluate(() => {
    const videoRect = document.querySelector("video").getBoundingClientRect();
    const captionRect = document.querySelector("#transly-caption-window").getBoundingClientRect();
    return Math.round(videoRect.bottom - captionRect.bottom);
  })).toBeGreaterThan(79);
  await videoPage.locator(".html5-video-player").evaluate((node) => node.classList.add("ytp-autohide"));

  await controls.locator(".appearance").click();
  await expect(controls.locator(".panel")).toBeVisible();
  await controls.locator('[data-order="translation-first"]').click();
  await controls.locator('[data-setting="subtitleSourceFontSizePx"]').fill("22");
  await controls.locator('[data-setting="subtitleTranslationFontSizePx"]').fill("34");
  await controls.locator('[data-setting="subtitlePositionPercent"]').fill("4");
  await controls.locator('[data-setting="subtitleBackgroundOpacity"]').fill("0.4");

  await expect(caption).toHaveAttribute("data-language-order", "translation-first");
  await expect.poll(() => caption.evaluate((node) => ({
    sourceFontSize: node.style.getPropertyValue("--transly-subtitle-source-font-size"),
    translationFontSize: node.style.getPropertyValue("--transly-subtitle-translation-font-size"),
    background: node.style.getPropertyValue("--transly-subtitle-background-opacity")
  }))).toEqual({ sourceFontSize: "22px", translationFontSize: "34px", background: "0.4" });
  await expect.poll(() => caption.evaluate((node) => ({
    original: getComputedStyle(node.querySelector(".transly-caption-original")).order,
    translation: getComputedStyle(node.querySelector(".transly-caption-translation")).order
  }))).toEqual({ original: "2", translation: "1" });

  if (process.env.TRANSLY_CAPTURE) {
    await videoPage.screenshot({ path: process.env.TRANSLY_CAPTURE, fullPage: true });
  }

  await controls.locator('[data-mode="source-only"]').click();
  await expect(caption.locator(".transly-caption-translation")).toBeHidden();
  await expect(caption.locator(".transly-caption-original")).toBeVisible();
  await controls.locator('[data-mode="translation-only"]').click();
  await expect(caption.locator(".transly-caption-original")).toBeHidden();
  await expect(caption.locator(".transly-caption-translation")).toBeVisible();

  await videoPage.reload();
  await videoPage.evaluate(() => window.setSubtitleTime(1));
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect(videoPage.locator("#transly-caption-window")).toHaveAttribute("data-display-mode", "translation-only");
  await expect(videoPage.locator("#transly-caption-window")).toHaveAttribute("data-language-order", "translation-first");
  await expect(videoPage.locator("#transly-subtitle-controls")).toHaveAttribute("data-enabled", "true");

  await videoPage.locator("#transly-subtitle-controls .toggle").click();
  await expect(videoPage.locator("#transly-caption-window")).toHaveCount(0);
  await expect(videoPage.locator("#transly-subtitle-controls")).toHaveAttribute("data-enabled", "false");
});

test("Transly loads a disabled native subtitle track and restores it when turned off", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openDisabledTextTrackPage(extension, provider);
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("disabled");
  await videoPage.evaluate(() => window.setSubtitleTime(1));

  await videoPage.locator("#transly-subtitle-controls .toggle").click();
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("hidden");

  await videoPage.locator("#transly-subtitle-controls .toggle").click();
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("disabled");
});

test("a reader configures a provider, translates progressively, changes reading mode, and clears", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: article, tabId } = await openArticle(extension, provider);
  const popup = await openPopup(extension, tabId);

  await expect(popup.locator(".app-header")).toHaveCount(0);
  await expect(popup.locator("#clearArticle")).toHaveCount(0);
  await expect(popup.locator("#subtitleToggle")).toHaveCount(0);
  await expect(popup.locator("#providerState")).toHaveText("Ready");
  await expect(popup.locator("#providerValue")).toHaveText("OpenAI");
  await expect(popup.locator("#modelValue")).toHaveText("gpt-e2e-primary");
  await popup.locator("#targetLanguage").click();
  await expect(popup.locator(".language-option")).toHaveCount(9);
  const languageLayout = await popup.locator(".language-option").evaluateAll((items) => items.map((item) => {
    const label = item.querySelector(".language-option-label");
    return {
      itemHeight: Math.round(item.getBoundingClientRect().height),
      labelHeight: Math.round(label?.getBoundingClientRect().height || 0),
      whiteSpace: label ? getComputedStyle(label).whiteSpace : ""
    };
  }));
  expect(languageLayout.every(({ itemHeight, labelHeight, whiteSpace }) => (
    itemHeight <= 38 && labelHeight <= 20 && whiteSpace === "nowrap"
  ))).toBe(true);
  await popup.keyboard.press("Escape");
  if (process.env.TRANSLY_POPUP_CAPTURE) {
    await popup.screenshot({ path: process.env.TRANSLY_POPUP_CAPTURE, animations: "disabled" });
  }
  await popup.locator("#translateArticle").click();

  await expect(article.locator(".transly-loading").first()).toBeVisible();
  await expect(article.locator(".transly-translation:not(.transly-loading)").first()).toBeVisible();
  expect(await article.locator(".transly-loading").count()).toBeGreaterThan(0);

  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "translated");
  await expect(article.locator(".transly-loading")).toHaveCount(0);
  await expect(article.locator(".transly-translation:not(.transly-loading)")).toHaveCount(5);
  await expect(article.locator(".transly-translation a[href='https://example.com/reference']")).toBeVisible();

  const spacing = await article.locator("article > p").first().evaluate((source) => {
    const translation = source.nextElementSibling;
    const sourceStyle = getComputedStyle(source);
    const translationStyle = getComputedStyle(translation);
    return {
      sourceMarginBottom: parseFloat(sourceStyle.marginBottom),
      translationMarginTop: parseFloat(translationStyle.marginTop),
      translationMarginBottom: parseFloat(translationStyle.marginBottom)
    };
  });
  expect(spacing.sourceMarginBottom).toBe(0);
  expect(spacing.translationMarginTop).toBeLessThan(spacing.translationMarginBottom);

  const modePopup = await openPopup(extension, tabId);
  await expect(modePopup.locator("#translateArticle")).toHaveText("Restore original");
  await modePopup.locator("#articleDisplayMode").click();
  await expect(article.locator("html")).toHaveAttribute(
    "data-transly-article-display-mode",
    "translation-only"
  );
  const firstSource = article.locator("[data-transly-article-id='article-1']");
  await expect(firstSource).toBeHidden();
  const firstTranslation = article.locator(".transly-translation[data-transly-for='article-1']");
  await firstTranslation.click();
  await expect(firstSource).toBeVisible();

  const clearPopup = await openPopup(extension, tabId);
  await expect(clearPopup.locator("#translateArticle")).toHaveText("Restore original");
  await clearPopup.locator("#translateArticle").click();
  await expect(article.locator(".transly-translation")).toHaveCount(0);
  await expect(article.locator("h1")).toBeVisible();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "idle");

  expect(provider.translationRequests()).toHaveLength(1);
  expect(provider.translationRequests()[0].authorization).toBe(`Bearer ${provider.apiKey}`);
});

test("a reader switches models in the popup and the choice survives a browser restart", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  let { page: article, tabId } = await openArticle(extension, provider);
  let popup = await openPopup(extension, tabId);

  await popup.locator("#popupModelTrigger").click();
  await popup.locator(".popup-model-option[data-value='openai/gpt-e2e-fast']").click();
  await expect(popup.locator("#modelValue")).toHaveText("gpt-e2e-fast");
  await popup.locator("#translateArticle").click();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "translated");
  expect(provider.translationRequests().at(-1)?.model).toBe("openai/gpt-e2e-fast");

  await extension.restart();
  ({ page: article, tabId } = await openArticle(extension, provider));
  popup = await openPopup(extension, tabId);
  await expect(popup.locator("#providerState")).toHaveText("Ready");
  await expect(popup.locator("#modelValue")).toHaveText("gpt-e2e-fast");

  await popup.locator("#translateArticle").click();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "translated");
  expect(provider.translationRequests().at(-1)?.model).toBe("openai/gpt-e2e-fast");
});

test("a provider failure is visible and the reader can retry without reloading the extension", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: article, tabId } = await openArticle(extension, provider);
  provider.state.failNextTranslation = true;

  const popup = await openPopup(extension, tabId);
  await popup.locator("#translateArticle").click();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "error");
  await expect(article.locator(".transly-translation:not(.transly-loading)")).toHaveCount(0);

  const failedPopup = await openPopup(extension, tabId);
  await expect(failedPopup.locator("#translateArticle")).toHaveText("Translate this article");
  await expect(failedPopup.locator("#status")).toContainText("Could not reach the translation service");
  await failedPopup.locator("#translateArticle").click();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "translated");
  await expect(article.locator(".transly-translation:not(.transly-loading)")).toHaveCount(5);
  expect(provider.translationRequests()).toHaveLength(2);
});

test("an offline local provider leaves the page clean and explains how to recover", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: article, tabId } = await openArticle(extension, provider);
  provider.state.offline = true;

  const offlinePopup = await openPopup(extension, tabId);
  await expect(offlinePopup.locator("#providerState")).toHaveText("Offline");
  await expect(offlinePopup.locator("#status")).toContainText("Local translation service is offline");
  await expect(offlinePopup.locator("#translateArticle")).toBeEnabled();
  await offlinePopup.locator("#translateArticle").click();

  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "error");
  await expect(article.locator(".transly-loading")).toHaveCount(0);
  await expect(article.locator(".transly-error")).toHaveCount(0);
  await expect(article.locator("[data-transly-translated='true']")).toHaveCount(0);
  await expect(article.locator("article")).toBeVisible();

  const failedPopup = await openPopup(extension, tabId);
  await expect(failedPopup.locator("#translateArticle")).toHaveText("Translate this article");
  await expect(failedPopup.locator("#status")).toContainText("Local translation service is offline");

  provider.state.offline = false;
  await failedPopup.reload();
  await expect(failedPopup.locator("#providerState")).toHaveText("Ready");
  await failedPopup.locator("#translateArticle").click();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "translated");
});
