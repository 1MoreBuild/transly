# Transly

Chrome MV3 prototype for article and video subtitle translation through a local Native Messaging Host and Codex/ChatGPT authentication.

This project is an independent implementation. It is not a fork of Immersive Translate.

## Scope

- Article translation in top-level pages and article iframes, with adaptive contextual batches, bilingual and translation-only display modes, and click-to-reveal originals.
- Video subtitle translation for YouTube timed text, generic WebVTT, and Bilibili subtitle JSON.
- AI audit of visible article blocks after translation.
- Langfuse tracing of translation and audit model trajectories.

PDF, EPUB, OCR, image translation, and input-box translation are intentionally out of scope.

## Requirements

- macOS and Google Chrome 105 or newer.
- Node.js 20 or newer.
- A current Codex CLI installation logged in with ChatGPT.

## Install

```bash
npm install
npm run setup
```

`setup` checks macOS, Node.js, Google Chrome, and Codex ChatGPT login, then installs and verifies the user-level Native Messaging Host. It does not send a model request.

If Codex is not logged in yet:

```bash
codex login
npm install
npm run setup
```

Then open `chrome://extensions`, enable Developer Mode, choose **Load unpacked**, and select this repository.

The manifest contains a public development key so the unpacked extension ID remains stable. The installer registers a user-level Native Messaging Host that only accepts that exact extension origin.

After moving the repository, changing the extension key, or changing the Native Host manifest or launcher, run `npm run native:install` again and reload the extension. Ordinary JavaScript source changes only require reloading the extension.

## Usage

Open the extension popup on a page and choose:

- **Translate article**
- **Clear article translations**
- **Enable subtitle overlay**

The Native Host starts automatically for translation requests. No local HTTP server or terminal process needs to remain running.

## Langfuse

Langfuse is optional and does not participate in translation. Without configuration, or when its optional packages cannot load, tracing is disabled and article/subtitle translation continues normally.

Create `.env.local` from `.env.example` and set:

```bash
LANGFUSE_SECRET_KEY=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_BASE_URL=...
```

Translation traces include the model prompt and output so the full translation trajectory can be inspected. This means article and subtitle text is also sent to the configured Langfuse project. OAuth credentials are redacted and never sent to the extension or Langfuse.

## Commands

```bash
npm test
npm run preflight
npm run setup
npm run native:install
npm run native:doctor
npm run native:smoke
npm run native:smoke:concurrent
npm run logs -- --limit 80
npm run native:uninstall
npm run codex:doctor
```

`native:smoke` sends one real GPT-5.6-Luna translation request. `native:smoke:concurrent` sends two. Both consume subscription capacity. Normal tests and `native:doctor` do not call the model.

## Troubleshooting

- After moving or renaming the cloned directory, rerun `npm run setup` and reload the unpacked extension.
- If the popup reports `Native host disconnected`, run `npm run native:doctor`, then `npm run native:install` if needed.
- To inspect the latest redacted Native Host timings, run `npm run logs -- --limit 80`. Logs are stored under `~/Library/Logs/Transly/`; they contain request IDs, phases, item counts, sanitized URLs, and latency metrics, but not article text, prompts, model output, or OAuth credentials.
- If GPT-5.6-Luna is unavailable for an account, set `TRANSLY_CODEX_MODEL` in `.env.local` to a Codex model available to that account.
- Chrome must load the repository root, not `src/`, as the unpacked extension directory.

## Architecture

Content scripts send validated requests to the MV3 background service worker. The service worker opens a task-scoped `chrome.runtime.connectNative()` port. The Native Host owns request scheduling, in-memory caching, Codex OAuth, model calls, and Langfuse tracing.

See [docs/architecture.md](docs/architecture.md) for the protocol and lifecycle.

## Provider Boundary

The current provider reads local Codex OAuth state and calls ChatGPT's Codex Responses backend directly. It uses the installed Codex model catalog to configure GPT-5.6-Luna and Responses Lite.

OAuth-bearing model requests are restricted to `https://chatgpt.com/backend-api`; the extension cannot configure or receive credentials.

The ChatGPT Codex backend is not a public stable API. Keep the provider isolated and expect compatibility updates when Codex changes. Codex app-server remains a possible future fallback.

## Research Boundary

High-level reverse-engineering observations are recorded under `docs/`. The locally installed Immersive Translate package is ignored by Git and must not be published or copied into this implementation.
