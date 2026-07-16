# Immersive Translate Reverse Notes

Date: 2026-06-30

Local source snapshot:

- `research/immersive-translate/1.30.3_0`
- Extension ID: `bpoadfkcbjbfhfodiogcnhhhpibjhbnh`
- Version: `1.30.3`

This document records behavior and architecture only. It is not a source-code copy plan.

## High-Level Shape

Immersive Translate is a broad MV3 extension, not just a translator overlay.

Core files:

- `manifest.json`: registers `content_guard.js` at `document_start` on all frames and exposes `content_main.js`, subtitle injectors, styles, and config JSON files as web-accessible resources.
- `content_guard.js`: small early loader. It decides whether the real content runtime should load.
- `content_main.js`: 3MB minified main content runtime. It handles page translation, dynamic DOM observation, subtitle orchestration, popup commands, injected UI, and special page modes.
- `background.js`: service worker and cross-extension service layer.
- `default_config.json`: full product config, including 766 site rules.
- `default_config.content.json`: content-runtime defaults.
- `video-subtitle/inject.js`: page-world script that hooks `fetch` and `XMLHttpRequest` for subtitles.
- `styles/inject.css`: bilingual translation and subtitle styles.

The important product design is:

- The guard script loads everywhere, but the heavy runtime is conditional.
- Page translation and subtitle translation share config/rule infrastructure.
- Translation is progressive by default.
- Site behavior is data-driven. The rules are merged from defaults plus `*.add` and versioned `*.add_v.*` fragments.

Rule count breakdown from the local snapshot:

- Total site rules: 766.
- Subtitle-related rules: 178.
- Page/article/selector-related rules: about 499.
- Approx subtitle-only rules: 34.

So the 766 rules are not just subtitle rules. Most rules tune page text extraction, exclusion, DOM mutation, container detection, page-specific CSS, or article-like selectors.

## Entry And Loading

Manifest:

- MV3.
- Background worker: `background.js`.
- Content script: `content_guard.js`.
- `run_at`: `document_start`.
- `all_frames`: true.
- `match_about_blank`: true.
- `match_origin_as_fallback`: true.
- Host access: all URLs.

`content_guard.js` does four jobs:

1. Creates a browser API bridge using the webextension polyfill.
2. Skips obvious ad/challenge frames and blocked domains.
3. Checks whether iframes are visible before loading the heavy runtime.
4. Dynamically imports `content_main.js` via `runtime.getURL(...)`, then calls `runContentMain()`.

Iframe handling is not naive. The guard asks the parent frame to check iframe visibility. It also uses size checks, viewport checks, `IntersectionObserver`, and a short fallback grace period. This avoids running a heavy translator in hidden ad iframes.

Our implication:

- We do not need its full iframe policy for v1.
- We should still run `all_frames: true` for subtitles because embedded players often live in iframes.
- For article translation, inspect all frames only after an explicit user action and route the command to the strongest article candidate rather than translating every frame.

## Config Model

There are two useful config files:

- `default_config.content.json`: runtime defaults used in the content script.
- `default_config.json`: full config, including the site rule table.

Important content defaults:

- `translationMode`: `dual`
- `translationPosition`: `after`
- `translationStartMode`: `dynamic`
- `immediateTranslationTextCount`: `4999`
- `immediateTranslationScrollLimitScreens`: `1`
- `cache`: true

Important text thresholds:

- `paragraphMinTextCount`: 2
- `blockMinTextCount`: 24
- `blockMinWordCount`: 4
- `mainFrameMinTextCount`: 50

Important article/body rule:

- `bodyRule.enable`: true
- `bodyRule.minTextLength`: 800
- `bodyRule.articleChildTags`: `P`
- `bodyRule.articleChildTagsNum`: 4
- `bodyRule.matchNodeRule`: requires signals such as a heading, paragraphs, or an `article` element.
- `bodyRule.contextReqLength`: 20000
- `bodyRule.contextTimeout`: 4000

The presence of `contextReqLength` matters. Immersive Translate does request article context for terminology, but it still translates progressively. It is not sending the whole article as one unit in normal mode.

Our implication:

- Their design optimizes cost, latency, and viewport relevance.
- Our Codex-subscription design should prefer fewer, larger requests with explicit full-article context.
- A good v1 default is still capped, for example 30k-40k chars of context and 20k-30k chars per batch.

## Page Translation Flow

The stable call chain visible in `content_main.js` is:

1. Runtime init builds global context and rules.
2. It initializes subtitle support.
3. It detects source language.
4. It decides whether auto-translation should start.
5. Manual commands from popup/float ball route into command handlers.
6. Normal page translation calls the HTML engine and then switches page state from original to translated.

Stable command names found in the bundle:

- `translatePage`
- `translateTheMainPage`
- `translateTheWholePage`
- `translateToThePageEndImmediately`
- `toggleTranslatePage`
- `toggleTranslateTheMainPage`
- `toggleTranslateTheWholePage`
- `restorePage`
- `retryFailedParagraphs`
- `switchTranslationMode`
- `toggleVideoSubtitlePreTranslation`
- `updateGlobalContext`

The popup has a main/body switch. In popup logic, whole page maps to `translationArea: "body"` and main page maps to `translationArea: "main"`.

Our implication:

- We only need a manual `Translate article` command.
- We should not clone the popup/float-ball architecture.
- We should support clear/restore because DOM mutation must be reversible.

## Article Detection

Immersive Translate does not just query `p` tags.

It combines:

- Global block tag lists.
- Inline tag lists.
- Stay-original tags such as code, image, math, `sup`, `sub`.
- Additional include selectors such as headings, `.article-title`, `.summary`, `.headline`, `.page-content`.
- Large exclude lists for code, share UI, material icons, no-translate regions, editable regions, nav-like regions, and its own injected UI.
- Body/article heuristics through `bodyRule`.
- Site-specific rules from `default_config.json`.
- Mutation observers for dynamic pages.

Example: Twitter/X has a dedicated page rule matching `twitter.com`, `x.com`, mobile, TweetDeck, pro, and embedded variants. It includes:

- `selectors` for tweet text, quoted tweet text, user descriptions, hover cards, cards, dialogs, Grok panes, and Twitter article read view.
- `excludeMatches` for settings, premium signup, account, analytics, chat, terms, privacy, and jobs pages.
- `additionalExcludeSelectors.add` for headers, sidebar, buttons, user-name/social metadata, tabs, video components, and its own caption container.
- `additionalStayOriginalSelectors` for links inside tweet text and profile/hover-card text.
- `extraBlockSelectors.add` and `extraInlineSelectors` for Twitter's nested `div/span` text structure.
- Low thresholds: `paragraphMinTextCount: 2`, `paragraphMinWordCount: 1`, `blockMinTextCount: 0`, `blockMinWordCount: 0`.
- `bodyRule.add.enable: false`, meaning it does not use the normal article body heuristic for Twitter; it relies on explicit selectors.
- `switchTranslateRestart: true`, `enableRichTranslate: true`, and mutation debounce config.

This explains why it works on modern app-style pages where text is nested in `div/span` structures rather than classic article paragraphs.

Relevant content config lists:

- `allBlockTags`: 53 block-ish tags.
- `inlineTags`: 47 inline-ish tags.
- `stayOriginalTags`: 16 tags.
- `additionalSelectors`: 21 selectors.
- `additionalExcludeSelectors`: 49 selectors.
- `mutationExcludeSelectors`: skip pre/code/highlight/own injected nodes.
- `mutationExcludeContainsSelectors`: skip containers likely to cause loops or wrong edits.

Body/article parsing behavior observed:

- It selects a body node and an article node.
- If an article node is found, it requests terminology/context using `articleNode.innerText` capped by `bodyRule.contextReqLength`.
- It builds translation containers from selected body/pre/main nodes.
- It stores paragraph entities and common ancestors.
- It marks walked/translated nodes with `data-imt-*` attributes.

Our implication:

- Our current `p/li/h*` extraction is too narrow.
- We should keep a strict first pass, then fallback to leaf block-like `div/section/article/main` nodes with enough text.
- We should score containers by text density and link density.
- We should skip nav/footer/aside/form/code/editable/no-translate and our own injected nodes.

## Dynamic DOM Handling

Immersive Translate keeps dynamic translation alive with multiple observers:

- Title observer for translating `document.title`.
- Body replacement observer for SPA reloads or React remounts.
- Mutation observer for newly added or dirty translated roots.
- Theme observer for dark/light style changes.
- Image/subtitle related observers.

The mutation path avoids self-triggered loops. It marks plugin updates, checks ancestors for recent plugin updates, skips its own translated nodes, and debounces restart work.

Our implication:

- For v1 article translation, we should avoid automatic mutation translation. Manual translation is less surprising and uses fewer model calls.
- For subtitles, dynamic behavior is required because cues and videos change over time.

## Rendering Model

The default mode is bilingual:

- Original text remains.
- Translation is inserted after the original block.
- The root/page gets state attributes such as `imt-state`.
- Translation wrappers use classes like `immersive-translate-target-wrapper` and translation block/inline wrappers.

It supports many visual themes: underline, dashed, highlight, marker, opacity, background, blockquote, etc.

Default render-related config in the local snapshot:

- `translationMode`: `dual`
- `translationPosition`: `after`
- `loadingTheme`: `spinner`
- `generalRule.targetWrapperTag`: `font`
- `generalRule.wrapperPrefix`: `smart`
- `generalRule.wrapperSuffix`: `smart`
- `generalRule.translationClasses`: `[]`

The default wrapper shape is roughly:

- Outer translation wrapper:
  - tag: configured `targetWrapperTag`, normally `font`
  - classes: `notranslate`, `immersive-translate-target-wrapper`
  - attributes: `translate="no"`, `lang=<targetLanguage>`
- Inner translation wrapper:
  - tag: same wrapper tag
  - classes: `notranslate`, `immersive-translate-target-inner`
  - attribute: `data-immersive-translate-translation-element-mark="1"`
- Block or inline wrapper:
  - block: `immersive-translate-target-translation-block-wrapper`
  - inline: `immersive-translate-target-translation-inline-wrapper`

The CSS does not make every translation blue. Theme classes decide how different the translation looks:

- `none`: effectively inherit from the page.
- `grey`: sets a theme color.
- `weakening`: uses opacity `0.618`.
- `italic` and `bold`: use font style/weight.
- underline, dashed, dotted, wavy, highlight, marker, background, blockquote: add visual decoration.
- `mask` and `opacity`: hide or weaken original/translation until hover.

This matters for our extension. Copying a few computed styles is only an approximation. A closer implementation is to create a stable wrapper that inherits page typography by default, then apply one optional theme class.

## Loading And Error Rendering

Immersive Translate inserts loading placeholders before model results arrive.

Observed functions and attributes:

- Loading id storage:
  - internal key: `immersiveTranslateLoadingId`
  - DOM dataset key: `data-immersive-translate-loading-id`
- Error id storage:
  - internal key: `immersiveTranslateErrorId`
  - DOM dataset key: `data-immersive-translate-error-id`
- Loading wrapper builder:
  - creates `targetWrapperTag`
  - adds `notranslate` and `immersive-translate-target-wrapper`
  - sets `translate="no"`
  - sets `lang=<targetLanguage>`
  - stores the loading id in dataset
  - appends a sanitized loading fragment from the current `loadingTheme`

The default loading fragment is based on `loadingTheme: "spinner"`, which maps to a class like `immersive-translate-loading-spinner`. The stylesheet also contains text/dark-mode loading styles and spinner animation.

Errors are rendered as their own wrapper, not only a toast. The error wrapper:

- uses `immersive-translate-target-wrapper-error`
- contains retry/help controls
- can trigger `retryFailedParagraphs`
- shows a richer error modal through the extension UI

Our implication:

- Loading should be a real per-paragraph translation node, inserted in the same position where the final translation will appear.
- On success, replace the loading node in place.
- On failure, replace it with a small retry/error node or remove it if the bridge is unreachable.
- Avoid debug outlines for normal loading; outlines are useful only for development.

## Rich Text Handling

Immersive Translate has a real rich-text path. It is not just plain text translation plus a blue paragraph.

The extraction path builds paragraph objects with:

- `text`: text sent to the translation service.
- `html`: sanitized rich HTML when rich translation is possible.
- `pureText`: plain text used for checks and fallbacks.
- `variables`: original DOM elements protected by placeholders.
- `richVariables`: rich tags protected by placeholders.

Important behavior:

- Elements matching stay-original rules are replaced with placeholders before translation.
- The extractor (`Cd`) keeps a separate `pureText` value containing only text that may be translated. Before a paragraph is accepted, `Os` removes placeholder variables; a paragraph with no remaining text is rejected. A later service-layer check (`tI`) also marks regex-masked input as `onlyPlaceholder` and returns the original without a model request.
- After translation, placeholders are replaced with sanitized original element HTML.
- DOMPurify is used with configured `domPurifyAddTags`.
- `enableRenderHtmlTag` is false by default, so arbitrary returned HTML is not trusted.
- Rich translation can be enabled per provider or per site; some sites explicitly disable it.
- Small inline items and code-like elements can stay original to avoid corrupting syntax.
- Translation-only mode has a special path that tries to map translated text back onto existing text nodes and marks the common ancestor with `data-imt-translation-only="1"`.

Our implication:

- The current implementation sends placeholder-marked per-block text and rehydrates links and protected nodes such as code, math, images, subscript, and superscript.
- Arbitrary emphasis runs are not yet mapped back into translated text.
- We should not let the model return arbitrary HTML. Return structured JSON with translated text plus placeholder tokens, then rebuild DOM ourselves.

Our implication:

- We only need one stable render style: insert translation after the source block.
- Keep our class names independent.
- Avoid modifying original text nodes unless needed for subtitles.

## Request And Rate Strategy

Immersive Translate supports many services and has service-specific limits:

- `maxTextLengthPerRequest`
- `maxTextGroupLengthPerRequest`
- `maxTextGroupLengthPerRequestForSubtitle`
- `subtitlePrompt`
- `multiplePrompt`
- `systemPrompt`
- `temperature`

It also has a strict rate limiter:

- Storage key: `RATE_LIMITER_TICKS`
- The limiter stores recent ticks per key.
- It computes delay from `{ limit, interval }`.
- It adds small random jitter before strict delay calculation.

Our implication:

- Its small-request design is correct for paid APIs, but wrong for Codex subscription auth because many small calls hit rate limits faster.
- Our Native Host should be the single concurrency authority, run at most five requests at once, and cache by URL/language/text hash.
- Langfuse should trace one high-level translate request plus each model batch.

## Subtitle Architecture

Subtitles are split into two layers.

Content runtime:

- Chooses a subtitle handler by `subtitleRule.type`.
- Initializes one handler instance.
- Handles page status changes, mode changes, quick button, attach overlay, download, AI subtitle hooks, and text-track fallback.

Injected page script:

- Runs in page context.
- Receives config from content script.
- Hooks `XMLHttpRequest.prototype.open/send`.
- Hooks `globalThis.fetch`.
- Uses `postMessage` with event type `imt-subtitle-inject`.
- Sends captured subtitle request/response back to the content script.

Handler map in `content_main.js` includes:

- `youtube`
- `youtube_iframe`
- `netflix`
- `webvtt`
- `khanacademy`
- `udemy`
- `hulu`
- `mubi`
- `edx`
- `text_track`
- `text_track_dynamic`
- `general`
- `live`
- `live_attach`
- `ebutt`
- `disneyplus`
- `fmp4.xml`
- `multi_attach_vtt`
- `twitter`
- `subsrt`
- `xml`
- `av`

The default content subtitle rule includes:

- `videoPlayerSelector`: `video`
- `translateGroupCount`: 5
- `aiSubtitleMaxTextLength`: 500
- `translationMode`: `dual`
- `translationPosition`: `bottom`
- `hookType`: `xhr`
- `preTranslation`: true

`default_config.json` contains 178 subtitle-related site rules. They are expressed as keys like `subtitleRule.add` and versioned `subtitleRule.add_v.[x.y.z]`, then merged into defaults.

Important site examples:

- YouTube:
  - `type`: `youtube`
  - `hookType`: `xhr_response`
  - subtitle URL regex: `/api/timedtext`
  - hides native caption window and attaches its own overlay.
- Common VTT:
  - `type`: `webvtt`
  - `hookType`: `xhr|fetch`
  - subtitle URL regex: `.vtt`
- TextTrack sites:
  - `type`: `text_track` or `text_track_dynamic`
  - reads native `video.textTracks` cues.
- Bilibili:
  - `type`: `general`
  - parses JSON fields like body/content/from/to.

Our implication:

- V1 should not chase 178 rules.
- Implement three generic paths:
  - YouTube `/api/timedtext`.
  - Generic `.vtt`/`.webvtt` via fetch/XHR hook.
  - Native `TextTrack` fallback.
- Add site rules later only when a real page fails.

## Subtitle Translation Flow

For file subtitles such as WebVTT/XML/JSON:

1. Hook captures subtitle URL or response.
2. Content runtime fetches or receives subtitle text.
3. Parser turns it into cue objects: `{ start, end, text }`.
4. Source language is detected from cue text.
5. If target equals source, skip.
6. Cues are translated in small groups.
7. Overlay or mutated subtitle file displays bilingual/translation-only text.

For native text tracks:

1. Observe video `textTracks`.
2. Listen for `cuechange`.
3. Deduplicate dynamic cues.
4. Translate only untranslated cues.
5. Replace cue text or attach a separate overlay.

For YouTube:

1. Hook watches `/api/timedtext`.
2. It can use YouTube player metadata to discover available tracks.
3. If a human target-language track exists and `humanPreferred` is true, it prefers human subtitles.
4. Otherwise it translates the source caption track.
5. It hides native captions and renders its own caption window.

Our implication:

- For our Codex model path, translating five cues per request is too chatty.
- Better v1: when we can capture the whole subtitle file, translate the whole file or large cue batches.
- For live/dynamic cues, use a rolling queue and batch by time window/text budget.

## What We Should Borrow Conceptually

Borrow:

- Early page-world subtitle hook.
- Rule-driven subtitle handler choice.
- Main/article/body distinction.
- Strict exclude lists.
- Leaf block fallback for modern `div`-based articles.
- Separate internal cue model.
- Reversible rendering.
- Cache plus one explicit Native Host concurrency limit.

Do not borrow:

- Full provider matrix.
- Float ball, side panel, account/payment, OCR, PDF, EPUB, manga/image flows.
- Micro-request API optimization.
- 178 site-specific subtitle rules in v1.
- Its class names, UI assets, provider adapters, or copied code.

## Historical Extraction Fix

The screenshot error `No article text found.` likely comes from our extractor being narrower than Immersive Translate's article detection.

The first implementation needed:

- Strict pass: headings, paragraphs, list items, blockquotes, captions, table cells.
- Fallback pass: visible leaf block-like `div/section/article/main` nodes with enough text.
- Container scoring by semantic tag, content-like class/id, text length, paragraph count, heading count, and link density.
- A max fallback block size so we do not translate a huge wrapper as one paragraph.
- Full article context sent once per batch.

These extraction layers are now implemented, with an AI audit as the repair path when deterministic extraction misses visible article content.
