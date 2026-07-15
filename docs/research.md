# Research Notes

Date: 2026-06-28.

Installed extension inspected:

- Extension ID: `bpoadfkcbjbfhfodiogcnhhhpibjhbnh`
- Version: `1.30.3`
- Local snapshot: `research/immersive-translate/1.30.3_0`
- Manifest: MV3
- Background: `background.js`
- Initial page script: `content_guard.js`
- Main content script loaded as web accessible resource: `content_main.js`
- Subtitle injected page script: `video-subtitle/inject.js`

## Relevant Product Shape

The installed extension is much broader than this project:

- Web page bilingual translation.
- Video subtitle translation.
- PDF, EPUB, OCR, manga/image translation.
- Input translation.
- Side panel and account/payment flows.
- Many translation providers.
- Large site-specific rule table.

For our version, only article translation and video subtitle translation matter.

## Article Translation Observations

Useful high-level behavior:

- It runs a page content script on most URLs.
- It uses site rules and selectors to decide what should be translated or ignored.
- It supports dual translation mode.
- It uses dynamic/progressive translation. The installed config has:
  - `translationStartMode: "dynamic"`
  - `immediateTranslationTextCount: 4999`
  - `immediateTranslationScrollLimitScreens: 1`
  - `cache: true`

Implication for this project:

- We should not translate one DOM node per request.
- We should extract article-level context first.
- We should batch paragraphs into fewer requests.
- We should render per paragraph so the UI remains readable.
- We should use semantic hints, a robust generic fallback, and an AI audit instead of copying hundreds of site rules.
- Current content-detection notes live in `docs/site-rules.md`.

## Article Rendering Implementation Notes

Implemented local rendering now follows the Immersive Translate shape more closely:

- Translation nodes are inserted as a stable wrapper after the source block.
- The wrapper is `notranslate` and contains a block wrapper plus an inner translation element.
- Loading uses the same wrapper location as the final translation and is replaced in place.
- Default visual style copies a safe typography subset from the source block at full opacity instead of applying a fixed translation color.
- Links and protected inline elements such as `code`, `kbd`, `math`, `svg`, `img`, `sub`, `sup`, and explicit no-translate nodes are replaced with `[[TRANSLY_PH_n]]` placeholders before translation.
- The bridge prompt tells the model to preserve placeholder tokens exactly.
- The content script rehydrates links with their original destination and computed link style, and restores protected inline nodes from local DOM clones.

This is still simpler than Immersive Translate rich translation. It does not yet preserve arbitrary emphasis structure or map translated text back into original inline DOM spans.

## Video Subtitle Observations

Useful high-level behavior:

- There is a dedicated injected script for subtitle request interception.
- It hooks `fetch` and `XMLHttpRequest`.
- It detects subtitle URLs by rule, such as YouTube `/api/timedtext` and WebVTT `.vtt`.
- It posts captured subtitle content back to the content script.
- It renders its own caption window and may hide native captions.
- The rule table contains many site-specific `subtitleRule` entries.

Implication for this project:

- First support a small core:
  - YouTube timed text.
  - Generic WebVTT through `fetch`/XHR hook.
  - Native `TextTrack` fallback later.
- Keep a small rule object per site.
- Use cue arrays as the stable internal data model.

## Local Codex Bridge

Machine state:

- `codex` is resolved from the user's `PATH`.
- `codex doctor` must report ChatGPT token auth is configured.
- `openclaw` is not part of this project. A stale local wrapper at `~/.local/bin/openclaw` was removed because it pointed to a deleted Opero app.

Decision:

- Use the same ChatGPT/Codex OAuth credential shape that OpenClaw uses, but call ChatGPT's Codex Responses endpoint directly.
- Keep the provider abstraction focused on Codex-backed local auth. The implementation does not depend on OpenClaw or its binary.
- Use Chrome Native Messaging for the local extension-to-provider boundary; do not expose an HTTP bridge.

## Local Snapshot Boundary

The Chrome-installed extension package is copied under `research/immersive-translate/1.30.3_0` so reverse-engineering work has a stable local input.

Do not copy proprietary source code, naming, UI, bundled assets, or provider adapters into our extension.

Allowed inputs:

- Public browser extension architecture.
- Manifest-level metadata.
- High-level behavioral observations.
- User-owned local runtime behavior.
