# AGENTS.md

Transly is a Chrome extension for context-aware AI translation through a user-configured OpenAI-compatible API. Article translation is the primary product; video subtitle translation is experimental.

## Installing For A User

When asked to install Transly:

1. Reuse the current checkout if it is Transly. Otherwise clone the repository into a `transly` folder in the current workspace without asking where to put it. Use `transly-install` only if that name contains unrelated files.
2. Read `README.md`, inspect the worktree, install dependencies, run `npx playwright install chromium`, then run `npm test`. Do not modify product source during a normal installation.
3. Do not send a real model request without explicit approval.
4. Run `npm run build`. Browser automation cannot reliably complete Chrome's **Load unpacked** flow. Return the generated `dist/extension` folder's exact absolute path and ask the user to open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select that folder.
5. Ask the user to open Transly's **Configure** page. They can use **Find local services** or enter an API URL and key; Transly loads available model names for selection.
6. Report completed checks, remaining manual steps, and whether any model request ran.

## Working On Transly

- Use Node.js 24 LTS. The supported runtime is recorded in `.nvmrc` and `package.json`.
- Translation quality is the primary product requirement. Preserve meaning, voice, terminology, links, and document structure.
- Transly owns the browser translation experience: extraction, batching, prompts, validation, caching, and rendering. It does not own model hosting, provider authentication, billing, or proxy operation.
- API keys stay in Chrome local extension storage and must never enter webpage code, logs, traces, or synced storage.
- Remote API URLs must use HTTPS. Plain HTTP is allowed only for localhost.
- Local discovery must remain user-triggered, limited to fixed loopback endpoints, and must not send stored credentials while probing.
- Read `DESIGN.md` before changing any user-facing layout, styling, motion, or interaction.
- Read `docs/architecture.md`, relevant source, and tests before changing behavior.
- Preserve unrelated worktree changes and update focused documentation when behavior changes.

Run `npm test`, `npm run package`, and `git diff --check` before finishing. The E2E suite must load the real unpacked extension and exercise user journeys against its deterministic local provider. State clearly whether verification used a real model request.

## Releasing

- A normal branch push runs CI only. It does not publish the extension.
- Pushing a `v*` tag triggers `.github/workflows/chrome-web-store.yml`, which uploads the package and, after the protected environment approval, submits it for Chrome Web Store review and automatic publishing.
- The same workflow can be dispatched manually to upload or submit a release.
- Never bump the package version, create or push a release tag, dispatch the release workflow, approve its protected environment, or submit a Chrome Web Store release unless the user explicitly asks to release a new version.
