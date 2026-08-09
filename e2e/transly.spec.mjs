import {
  configureProvider,
  expect,
  openDisabledTextTrackPage,
  openLongSubtitlePage,
  openArticle,
  openSemanticSubtitlePage,
  openSubtitlePage,
  openTargetSubtitlePage,
  openTextTrackPage,
  openTriggeredSubtitlePage,
  openSubtitlePreviewPage,
  openPopup,
  test
} from "./support/extension-fixture.mjs";

async function setPlayerSubtitles(page, enabled) {
  const controls = page.locator("#transly-subtitle-controls");
  const menuTrigger = controls.locator(".menu-trigger");
  const subtitleSwitch = controls.locator(".subtitle-switch");
  await menuTrigger.click();
  await expect(controls.locator(".panel")).toBeVisible();
  if ((await subtitleSwitch.getAttribute("aria-checked")) !== String(enabled)) {
    await subtitleSwitch.click();
  }
  await expect(subtitleSwitch).toHaveAttribute("aria-checked", String(enabled));
  await menuTrigger.click();
  await expect(controls.locator(".panel")).toBeHidden();
}

test("an active YouTube preview gets a cached Transly control below CC", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openSubtitlePreviewPage(extension, provider);

  await videoPage.waitForTimeout(250);
  await expect(videoPage.locator("#transly-subtitle-controls")).toHaveCount(0);

  await videoPage.evaluate(() => window.setPreviewState(true));
  const controls = videoPage.locator("#transly-subtitle-controls");
  await expect(controls).toBeVisible();
  await expect(controls).toHaveAttribute("data-context", "preview");
  const controlBox = await controls.boundingBox();
  const ccBox = await videoPage.locator("yt-closed-captions-toggle-button").boundingBox();
  expect(controlBox.y).toBeGreaterThan(ccBox.y + ccBox.height);
  expect(Math.abs((controlBox.x + controlBox.width / 2) - (ccBox.x + ccBox.width / 2))).toBeLessThan(2);

  await controls.locator(".menu-trigger").click();
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitles-enabled", "true");
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect.poll(() => provider.translationRequests().length).toBe(1);
  const prompt = provider.translationRequests()[0].prompt;
  const [contextSection, translationSection] = prompt.split("TEXT TO TRANSLATE");
  expect(contextSection).toContain("Title: How thoughtful tools improve creative work");
  expect(contextSection).toContain("Channel: Transly Research");
  expect(translationSection).not.toContain("How thoughtful tools improve creative work");
  expect(translationSection).not.toContain("Transly Research");

  await videoPage.evaluate(() => window.setPreviewState(false));
  await expect(controls).toBeHidden();
  await expect(videoPage.locator("#transly-caption-window")).toBeHidden();

  await videoPage.evaluate(() => window.rebuildPreview(true));
  await expect(controls).toBeVisible();
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await videoPage.waitForTimeout(350);
  expect(provider.translationRequests()).toHaveLength(1);

  await videoPage.evaluate(() => window.switchPreviewVideo(
    "second-preview-video",
    "A different video with the same opening captions"
  ));
  await expect(controls).toBeVisible();
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect.poll(() => provider.translationRequests().length).toBe(2);
  expect(provider.translationRequests()[1].prompt).toContain("A different video with the same opening captions");

  await videoPage.reload();
  await videoPage.evaluate(() => window.setPreviewState(true));
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await videoPage.waitForTimeout(350);
  expect(provider.translationRequests()).toHaveLength(2);
});

test("a viewer enables bilingual subtitles, follows playback, and keeps them across reloads", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openSubtitlePage(extension, provider);
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.readyState)).toBeGreaterThan(0);
  await videoPage.evaluate(() => window.setSubtitleTime(1));
  await setPlayerSubtitles(videoPage, true);
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

  await setPlayerSubtitles(videoPage, false);
  await expect(videoPage.locator("#transly-caption-window")).toHaveCount(0);
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitles-enabled", "false");
});

test("subtitle translation keeps a complete utterance together and preserves timed cue order", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openSemanticSubtitlePage(extension, provider);

  await setPlayerSubtitles(videoPage, true);
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
  await setPlayerSubtitles(videoPage, true);
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitle-status", "ready");
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("hidden");

  await setPlayerSubtitles(videoPage, false);
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("showing");
});

test("target-language captions stay native and never call the translation model", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openTargetSubtitlePage(extension, provider);
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.readyState)).toBeGreaterThan(0);
  await videoPage.evaluate(() => window.setSubtitleTime(1));

  await setPlayerSubtitles(videoPage, true);

  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitle-status", "native");
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitle-source-language", "zh");
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitle-skip-reason", "source-matches-target");
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("showing");
  await expect(videoPage.locator("#transly-caption-window")).toBeHidden();
  expect(provider.translationRequests()).toHaveLength(0);

  const diagnostics = await extension.context.newPage();
  await diagnostics.goto(`chrome-extension://${extension.extensionId}/options.html?debug=1`);
  await expect(diagnostics.locator(".debug-panel")).toBeVisible();
  await expect(diagnostics.locator(".debug-event").first()).toContainText("native");
  await expect(diagnostics.locator(".debug-event").first()).toContainText("source-matches-target");
  await diagnostics.close();

  const normalOptions = await extension.context.newPage();
  await normalOptions.goto(`chrome-extension://${extension.extensionId}/options.html`);
  await expect(normalOptions.locator(".debug-panel")).toHaveCount(0);
  await normalOptions.close();

  await videoPage.evaluate(() => window.switchToSourceCaptions());
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitle-status", "ready");
  await expect.poll(() => provider.translationRequests().length).toBe(1);
});

test("subtitle failures expose the error only in hidden diagnostics", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  provider.state.failNextTranslation = true;
  const { page: videoPage } = await openTextTrackPage(extension, provider);
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.readyState)).toBeGreaterThan(0);
  await videoPage.evaluate(() => window.setSubtitleTime(1));

  await setPlayerSubtitles(videoPage, true);

  await expect(videoPage.locator("html")).toHaveAttribute("data-transly-subtitle-status", "error");
  const controlState = await videoPage.locator("#transly-subtitle-controls").evaluate((node) => {
    const statusDot = node.shadowRoot.querySelector(".status-dot");
    const trigger = node.shadowRoot.querySelector(".menu-trigger");
    return {
      dotColor: getComputedStyle(statusDot).backgroundColor,
      title: trigger.title
    };
  });
  expect(controlState.dotColor).toBe("rgb(239, 68, 68)");
  expect(controlState.title).toContain("Planned provider outage");

  const diagnostics = await extension.context.newPage();
  await diagnostics.goto(`chrome-extension://${extension.extensionId}/options.html?debug=1`);
  const latestEvent = diagnostics.locator(".debug-event").first();
  await expect(latestEvent).toContainText("error");
  await expect(latestEvent).toContainText("Planned provider outage");
});

test("partial subtitle failures remain visible in hidden diagnostics", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  provider.state.failTranslationNumber = 2;
  const { page: videoPage } = await openLongSubtitlePage(extension, provider);
  await videoPage.evaluate(() => window.setSubtitleTime(600));
  await videoPage.locator(".html5-video-player").evaluate((node) => node.classList.remove("ytp-autohide"));
  await setPlayerSubtitles(videoPage, true);

  await expect(videoPage.locator("#transly-caption-window")).toContainText("长视频第 11 句。");
  await expect.poll(() => provider.translationRequests().length).toBeGreaterThanOrEqual(2);

  const diagnostics = await extension.context.newPage();
  await diagnostics.goto(`chrome-extension://${extension.extensionId}/options.html?debug=1`);
  await expect(diagnostics.locator(".debug-event").first()).toContainText("Last error");
  await expect(diagnostics.locator(".debug-event").first()).toContainText("Planned provider outage");
});

test("enabling subtitles triggers a player caption request when captions start off", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openTriggeredSubtitlePage(extension, provider);
  await expect(videoPage.locator(".ytp-subtitles-button")).toHaveAttribute("aria-pressed", "false");
  await videoPage.evaluate(() => window.setSubtitleTime(1));
  await videoPage.locator(".html5-video-player").evaluate((node) => node.classList.remove("ytp-autohide"));

  await setPlayerSubtitles(videoPage, true);

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
  await expect(controls).toBeHidden();
  await videoPage.locator(".html5-video-player").evaluate((node) => node.classList.remove("ytp-autohide"));
  await expect(controls).toBeVisible();
  await expect(controls).toHaveAttribute("data-placement", "floating");
  await expect(controls.locator(".menu-trigger")).toHaveAttribute("aria-label", "Transly subtitle settings");
  await expect(controls.locator(".menu-trigger")).toHaveAttribute("aria-expanded", "false");
  await expect(controls.locator(".brand-icon")).toHaveAttribute("src", /transly-player\.svg$/);
  await expect.poll(() => controls.evaluate((node) => node.parentElement === document.documentElement)).toBe(true);
  await expect.poll(() => controls.evaluate((node) => ({
    width: Math.round(node.getBoundingClientRect().width),
    height: Math.round(node.getBoundingClientRect().height)
  }))).toEqual({ width: 52, height: 36 });
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
  await expect.poll(() => controls.evaluate((node) => {
    const surface = getComputedStyle(node.shadowRoot.querySelector(".control"));
    return {
      borderRadius: surface.borderRadius,
      backgroundColor: surface.backgroundColor
    };
  })).toEqual({ borderRadius: "18px", backgroundColor: "rgba(0, 0, 0, 0.5)" });
  await setPlayerSubtitles(videoPage, true);

  await expect(videoPage.locator(".ytp-subtitles-button")).toHaveAttribute("aria-pressed", "true");
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect(controls).toHaveAttribute("data-state", "ready");
  await expect(controls).toHaveAttribute("data-enabled", "true");
  await expect.poll(() => controls.evaluate((node) => {
    const mark = getComputedStyle(node.shadowRoot.querySelector(".status-dot"));
    return {
      width: mark.width,
      height: mark.height,
      backgroundColor: mark.backgroundColor,
      borderRightColor: mark.borderRightColor,
      borderBottomColor: mark.borderBottomColor
    };
  })).toEqual({
    width: "7px",
    height: "4px",
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderRightColor: "rgb(34, 197, 94)",
    borderBottomColor: "rgb(34, 197, 94)"
  });

  const caption = videoPage.locator("#transly-caption-window");
  await videoPage.locator(".html5-video-player").evaluate((node) => node.classList.add("ytp-autohide"));
  await expect(controls).toBeHidden();
  await expect.poll(() => videoPage.evaluate(() => {
    const videoRect = document.querySelector("video").getBoundingClientRect();
    const captionRect = document.querySelector("#transly-caption-window").getBoundingClientRect();
    return Math.round(videoRect.bottom - captionRect.bottom);
  })).toBe(32);
  await videoPage.locator(".html5-video-player").evaluate((node) => node.classList.remove("ytp-autohide"));
  await expect(controls).toBeVisible();
  await expect.poll(() => videoPage.evaluate(() => {
    const videoRect = document.querySelector("video").getBoundingClientRect();
    const captionRect = document.querySelector("#transly-caption-window").getBoundingClientRect();
    return Math.round(videoRect.bottom - captionRect.bottom);
  })).toBeGreaterThan(79);
  await controls.locator(".menu-trigger").click();
  await expect(controls.locator(".panel")).toBeVisible();
  await expect.poll(() => videoPage.evaluate(() => ({
    controls: Number(getComputedStyle(document.querySelector("#transly-subtitle-controls")).zIndex),
    caption: Number(getComputedStyle(document.querySelector("#transly-caption-window")).zIndex)
  }))).toEqual({ controls: 2147483647, caption: 2147483646 });
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

  await videoPage.locator(".html5-video-player").evaluate((node) => node.classList.remove("ytp-autohide"));
  await setPlayerSubtitles(videoPage, false);
  await expect(videoPage.locator("#transly-caption-window")).toHaveCount(0);
  await expect(videoPage.locator("#transly-subtitle-controls")).toHaveAttribute("data-enabled", "false");
});

test("long subtitles translate around the playhead and remain available after seeking back", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openLongSubtitlePage(extension, provider);
  await videoPage.evaluate(() => window.setSubtitleTime(600));
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.currentTime)).toBe(600);
  await videoPage.locator(".html5-video-player").evaluate((node) => node.classList.remove("ytp-autohide"));
  await setPlayerSubtitles(videoPage, true);

  await expect(videoPage.locator("#transly-caption-window")).toContainText("长视频第 11 句。");
  await expect.poll(() => provider.translationRequests().length).toBe(2);
  const firstTranslationInput = provider.translationRequests()[0].prompt.split("TEXT TO TRANSLATE")[1];
  expect(firstTranslationInput).toContain("Long cue 10.");
  expect(firstTranslationInput).toContain("Long cue 11.");
  expect(firstTranslationInput).toContain("Long cue 12.");
  expect(firstTranslationInput).not.toContain("Long cue 13.");
  expect(firstTranslationInput).not.toContain("Long cue 1.");

  await videoPage.evaluate(() => window.setSubtitleTime(60));
  await expect(videoPage.locator("#transly-caption-window")).toContainText("长视频第 2 句。");
  await expect.poll(() => provider.translationRequests().length).toBe(4);
  const seekTranslationInput = provider.translationRequests()[2].prompt.split("TEXT TO TRANSLATE")[1];
  expect(seekTranslationInput).toContain("Long cue 1.");
  expect(seekTranslationInput).toContain("Long cue 2.");
  expect(seekTranslationInput).toContain("Long cue 3.");

  const requestsBeforeCachedSeek = provider.translationRequests().length;
  await videoPage.evaluate(() => window.setSubtitleTime(600));
  await expect(videoPage.locator("#transly-caption-window")).toContainText("长视频第 11 句。", { timeout: 500 });
  await videoPage.waitForTimeout(200);
  expect(provider.translationRequests()).toHaveLength(requestsBeforeCachedSeek);
});

test("Transly loads a disabled native subtitle track and restores it when turned off", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: videoPage } = await openDisabledTextTrackPage(extension, provider);
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("disabled");
  await videoPage.evaluate(() => window.setSubtitleTime(1));

  await setPlayerSubtitles(videoPage, true);
  await expect(videoPage.locator("#transly-caption-window")).toContainText("视频中的第一句字幕。");
  await expect.poll(() => videoPage.locator("video").evaluate((video) => video.textTracks[0]?.mode)).toBe("hidden");

  await setPlayerSubtitles(videoPage, false);
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
  await expect(article.locator(".transly-translation:not(.transly-loading)")).toHaveCount(9);
  await expect(article.locator(".transly-translation a[href='https://example.com/reference']")).toBeVisible();
  await expect(article.locator(".transly-translation .edit-control a[href='https://auth.example.com/edit'] svg")).toBeVisible();
  await expect(article.locator(".transly-translation a.reference-icon[href='https://example.com/reference-icon'] svg")).toBeVisible();
  await expect(article.locator("#direct-table-cell > .transly-translation")).toBeVisible();
  await expect(article.locator("#grid-source > .transly-translation")).toBeVisible();
  await expect(article.locator(".comparison-grid > .transly-translation")).toHaveCount(0);
  await expect(article.locator("#protected-code .transly-translation")).toHaveCount(0);
  await expect(article.locator("#protected-formula .transly-translation")).toHaveCount(0);
  const translatedText = await article.locator(".transly-translation").allTextContents();
  expect(translatedText.join(" ")).not.toContain("https://auth.example.com/edit");
  expect(translatedText.join(" ")).not.toContain("https://example.com/reference-icon");

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
  await expect(modePopup.locator("#translateArticle")).toHaveText("Restore");
  await expect(modePopup.locator("#articleDisplayMode")).toContainText("Bilingual");
  await expect(modePopup.locator("#articleDisplayMode .display-mode-glyph")).toHaveText("文A");
  await modePopup.locator("#articleDisplayMode").click();
  await expect(modePopup.locator("#articleDisplayMode")).toContainText("Translation");
  await expect(modePopup.locator("#articleDisplayMode .display-mode-glyph")).toHaveText("文");
  await expect(article.locator("html")).toHaveAttribute(
    "data-transly-article-display-mode",
    "translation-only"
  );
  const plainSource = article.locator("[data-transly-article-id='article-2']");
  await expect(plainSource).toBeHidden();
  const plainTranslation = article.locator(".transly-translation[data-transly-for='article-2']");
  await plainTranslation.click();
  await expect(plainSource).toBeVisible();

  const clearPopup = await openPopup(extension, tabId);
  await expect(clearPopup.locator("#translateArticle")).toHaveText("Restore");
  await expect(clearPopup.locator("#articleDisplayMode")).toContainText("Translation");
  await clearPopup.locator("#translateArticle").click();
  await expect(article.locator(".transly-translation")).toHaveCount(0);
  await expect(article.locator("h1")).toBeVisible();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "idle");

  expect(provider.translationRequests()).toHaveLength(1);
  expect(provider.translationRequests()[0].authorization).toBe(`Bearer ${provider.apiKey}`);
  expect(provider.translationRequests()[0].prompt).not.toContain("https://auth.example.com/edit");
  expect(provider.translationRequests()[0].prompt).not.toContain("https://example.com/reference-icon");
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

test("the settings page automatically restores the provider model catalog", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const requestsBeforeOpen = provider.state.requests.filter((request) => request.kind === "models").length;

  const options = await extension.context.newPage();
  await options.goto(`chrome-extension://${extension.extensionId}/options.html`);
  await expect(options.locator("html")).toHaveAttribute("data-transly-options-ready", "true");
  await expect(options.locator("#modelHint")).toHaveText(
    `${provider.models.length} available models. Choose one from the list.`
  );

  await options.locator("#modelTrigger").click();
  await expect(options.locator(".model-option")).toHaveCount(provider.models.length);
  expect(provider.state.requests.filter((request) => request.kind === "models")).toHaveLength(requestsBeforeOpen + 1);
});

test("the model menu stays inside the browser-action popup and scrolls", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { tabId } = await openArticle(extension, provider);
  const popup = await openPopup(extension, tabId);
  await popup.setViewportSize({ width: 352, height: 400 });

  await popup.locator("#popupModelTrigger").click();
  const list = popup.locator("#popupModelList");
  const menu = popup.locator(".model-popup");
  await expect(list).toBeVisible();
  const geometry = await menu.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      viewportHeight: innerHeight
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(8);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight - 8);
  await expect.poll(() => list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);

  const lastModel = popup.locator(".popup-model-option").last();
  await lastModel.scrollIntoViewIfNeeded();
  await expect(lastModel).toBeVisible();
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
  await expect(failedPopup.locator("#translateArticle")).toHaveText("Translate");
  await expect(failedPopup.locator("#status")).toContainText("Could not reach the translation service");
  await failedPopup.locator("#translateArticle").click();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "translated");
  await expect(article.locator(".transly-translation:not(.transly-loading)")).toHaveCount(9);
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
  await expect(failedPopup.locator("#translateArticle")).toHaveText("Translate");
  await expect(failedPopup.locator("#status")).toContainText("Local translation service is offline");

  provider.state.offline = false;
  await failedPopup.reload();
  await expect(failedPopup.locator("#providerState")).toHaveText("Ready");
  await failedPopup.locator("#translateArticle").click();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "translated");
});
