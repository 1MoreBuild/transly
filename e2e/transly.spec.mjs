import {
  configureProvider,
  expect,
  openArticle,
  openPopup,
  test
} from "./support/extension-fixture.mjs";

test("a reader configures a provider, translates progressively, changes reading mode, and clears", async ({
  extension,
  provider
}) => {
  await configureProvider(extension, provider);
  const { page: article, tabId } = await openArticle(extension, provider);
  const popup = await openPopup(extension, tabId);

  await expect(popup.locator("#connectionLabel")).toHaveText("Configured");
  await expect(popup.locator("#providerValue")).toHaveText("OpenAI");
  await expect(popup.locator("#modelValue")).toHaveText("gpt-e2e-primary");
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
  await clearPopup.locator("#clearArticle").click();
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
  await expect(popup.locator("#connectionLabel")).toHaveText("Configured");
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
  await expect(failedPopup.locator("#articleState")).toHaveText("Last run failed");
  await failedPopup.locator("#translateArticle").click();
  await expect(article.locator("html")).toHaveAttribute("data-transly-article-status", "translated");
  await expect(article.locator(".transly-translation:not(.transly-loading)")).toHaveCount(5);
  expect(provider.translationRequests()).toHaveLength(2);
});
