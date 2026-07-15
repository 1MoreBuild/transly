# AGENTS.md

This file contains repository-level instructions for coding agents working on Transly.

## Project Purpose

Transly is a local-first Chrome MV3 extension for two workflows only:

- Article translation.
- Video subtitle translation.

The extension uses Chrome Native Messaging to reach a local Node.js host. The host uses the user's existing Codex/ChatGPT authentication and currently targets GPT-5.6-Luna. Translation quality is the primary product requirement.

Do not expand the product into PDF, EPUB, OCR, image, input-box, or document translation unless the user explicitly changes the scope.

## Start Here

Read these files before making architectural changes:

1. `README.md` for setup, commands, and supported workflows.
2. `docs/architecture.md` for trust boundaries, protocol, lifecycle, and batching.
3. `bridge/translation-prompt.mjs` for the model contract.
4. `src/content/article.js` and `src/content/article-batching.js` for article extraction, rendering, and request planning.
5. `native-host/host.mjs` for the global request queue.

## Local Setup

Requirements:

- macOS.
- Google Chrome 105 or newer.
- Node.js 20 or newer.
- Codex CLI installed and logged in with ChatGPT.

Install and register the Native Messaging Host:

```bash
npm install
npm run setup
```

Then open `chrome://extensions`, enable Developer Mode, select **Load unpacked**, and choose the repository root.

`npm run setup` performs checks and installs the user-level Native Messaging manifest. It does not call a model. Rerun it after moving the repository or changing the extension key, host manifest, or launcher installation logic.

The Native Host starts automatically when Chrome connects. Do not add a localhost HTTP bridge or require a long-running terminal process.

## Commands

```bash
npm test
npm run preflight
npm run native:doctor
npm run codex:doctor
npm run logs -- --limit 80
```

These commands make real model requests and consume subscription capacity:

```bash
npm run native:smoke
npm run native:smoke:concurrent
```

Use real smoke tests when changing authentication, the Codex transport, Native Messaging, streaming, or the translation prompt. State clearly when a real request was or was not run.

## Architecture Invariants

Keep these boundaries intact:

- Content scripts never read Codex credentials.
- The MV3 service worker never receives Codex credentials.
- OAuth state stays inside the local Native Host process.
- Model requests are restricted to the pinned ChatGPT Codex backend. Keep the backend URL security tests passing.
- Chrome Native Messaging is the only browser-to-host transport.
- The Native Host verifies the exact extension origin at startup.
- Native Host stdout is reserved for length-prefixed protocol frames.
- Langfuse is optional. Translation must continue when Langfuse is absent or misconfigured.

Do not introduce wildcard CORS, a localhost listener, browser-readable auth tokens, or configurable OAuth-bearing backend URLs.

## Request Scheduling

There is one concurrency authority: `native-host/host.mjs`.

- The Native Host runs at most five model requests concurrently and queues the rest.
- The browser must not add a second worker queue, stagger timer, semaphore, or fixed batch-count cap.
- Article batches are derived from character and item budgets. Long articles may produce more than five batches.
- The browser submits all batches in viewport-priority order.
- Article scripts may run in multiple frames, but one explicit article action must target only the best article frame.
- A batch is rendered only after its complete response has been parsed and validated.
- The AI coverage audit runs after all initial article batches settle.

Keep scheduling policy out of the popup and content scripts. If the global concurrency policy changes, change it in the Native Host and update `docs/architecture.md`.

## Translation Quality Contract

Translation quality takes priority over token minimization.

- Give the model ordered article-level context so it can resolve terminology, references, pronouns, and tone.
- Give the model only the current batch as text to translate.
- Do not put URLs, DOM selectors, internal element IDs, transport metadata, or verbose JSON objects into the translation text.
- Preserve natural source blocks. Do not split a paragraph merely to create more requests.
- Ask for native, publication-ready target-language writing, not source-language syntax with substituted words.
- Preserve facts, nuance, author voice, proper nouns, product/model names, code identifiers, URLs, and placeholder tokens.
- Use technical terminology practitioners actually use. Do not force established English technical terms into awkward translations.
- Keep the model response contract minimal: an ordered JSON array of translated strings. Map strings back to internal IDs in code.
- Validate response count and placeholder integrity before rendering.
- On placeholder mismatch, retry only affected passages once; do not silently drop links or repeat the whole batch.

Prompt changes require focused tests in `bridge/translation-prompt.test.mjs`. For meaningful quality changes, run a representative real translation and report the actual output.

## Article Extraction And Rendering

Prefer generic, semantic, AI-assisted handling over a growing list of fragile site-specific selectors.

- Exclude hidden, inert, navigation, form, code, and explicitly non-translatable content.
- Preserve links, line breaks, code, and protected inline nodes through placeholders.
- Insert translations next to their source blocks.
- Match source color, size, weight, style, line height, letter spacing, and alignment.
- Keep translated prose on the Transly sans-serif stack for readability.
- Preserve clear source-to-translation and translation-to-next-block spacing.
- Support both bilingual and translation-only display modes. In translation-only mode, clicking a translation can reveal its source.

The AI audit is a repair loop for missed visible content. It does not justify sending the full DOM or screenshots to every translation request.

## Subtitle Translation

Subtitle translation should operate on complete subtitle resources when possible, preserve cue timing, and use video-level context. Submit subtitle batches without a second browser-side queue; the Native Host owns concurrency. Keep the on-page overlay synchronized with `video.currentTime`. Do not mix article DOM extraction rules into subtitle handling.

## Cache And Observability

The current translation cache is an in-process `Map` in `bridge/server.mjs`. It is intentionally ephemeral and disappears when the Native Host exits. Cache keys include the page URL, target language, batch IDs, and source text. Concurrent misses for the same key share one in-flight model request.

Langfuse traces may contain article or subtitle text, prompts, and model output. Never include OAuth credentials or environment secrets. Local JSONL diagnostics must contain only redacted metadata, counts, phases, sanitized URLs, and timings.

## Repository Map

- `popup.html`, `popup.css`, `popup.js`: extension popup.
- `src/background.js`: MV3 service worker and Native Messaging client.
- `src/content/article.js`: article discovery, extraction, rendering, and audit loop.
- `src/content/article-batching.js`: pure article batch planning.
- `src/content/subtitle-content.js`: subtitle capture and overlay.
- `src/injected/subtitle-hook.js`: page-context subtitle interception.
- `native-host/`: installer, protocol, queue, diagnostics, and smoke tests.
- `bridge/`: Codex transport, prompt construction, caching, parsing, quality checks, and Langfuse.
- `docs/`: maintained project documentation and high-level research notes.
- `research/immersive-translate/`: local research artifacts and notes.

## Research And Licensing Boundary

Transly is an independent implementation, not a fork of Immersive Translate.

- Do not commit extracted proprietary extension bundles.
- `research/immersive-translate/1.30.3_0/` is intentionally ignored.
- High-level behavioral observations and independently written notes may be committed.
- Do not copy proprietary source, minified bundles, branding, icons, or text into production code.

## Change Discipline

- Inspect the existing worktree before editing. Do not revert unrelated user changes.
- Keep changes scoped to the requested behavior.
- Use the existing plain JavaScript and Node ESM style.
- Avoid dependencies unless they remove substantial complexity.
- Add tests for pure batching, parsing, validation, security, and prompt behavior.
- Run `npm test` and `git diff --check` before declaring work complete.
- Run `node --check` for changed JavaScript files not exercised by tests.
- After extension code changes, reload the unpacked extension and refresh the target page.
- Do not claim a change was pushed or committed unless `git status`, `git log`, and the remote state confirm it.

## Definition Of Done

A change is done when:

1. The requested behavior works through the real extension architecture, not only a helper script.
2. Translation quality and full-context behavior have not regressed.
3. Security boundaries remain intact.
4. Relevant tests pass.
5. Documentation matches the implementation.
6. The final report states what changed, what was tested, and whether any real model request was made.
