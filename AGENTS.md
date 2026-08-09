# AGENTS.md

Transly is a Chrome extension for context-aware AI translation through a user-configured OpenAI-compatible API.

## Installing For A User

When asked to install Transly:

1. Prefer the official Chrome Web Store release linked from `README.md`. Do not clone or build the repository for a normal user installation unless the user explicitly asks for a source or development build.
2. For a source build, reuse the current checkout if it is Transly. Otherwise clone the repository into a `transly` folder in the current workspace without asking where to put it. Use `transly-install` only if that name contains unrelated files.
3. Read `README.md`, inspect the worktree, and follow the repository's current prerequisites, installation instructions, and package scripts. Do not modify product source during installation.
4. Do not send a real model request without explicit approval.
5. Complete every step that can be automated. If Chrome still requires a manual action, report the generated extension's exact absolute path and give the shortest accurate instruction. Do not claim that Chrome loaded the extension unless that was verified.
6. Report completed checks, remaining manual steps, and whether any model request ran.

## Working On Transly

- Translation quality is the primary product requirement. Preserve meaning, voice, terminology, links, and document structure.
- Transly owns the browser translation experience: extraction, batching, prompts, validation, caching, and rendering. It does not own model hosting, provider authentication, billing, or proxy operation.
- API keys stay in Chrome local extension storage and must never enter webpage code, logs, traces, or synced storage.
- Remote API URLs must use HTTPS. Plain HTTP is allowed only for localhost.
- Local discovery must remain user-triggered, limited to fixed loopback endpoints, and must not send stored credentials while probing.
- Read `DESIGN.md` before changing any user-facing layout, styling, motion, or interaction.
- Read `docs/architecture.md`, relevant source, and tests before changing behavior.
- Treat packaged-extension E2E journeys as the product baseline. Add or update an E2E regression for user-visible behavior changes and bug fixes.
- Keep contract tests only for pure algorithms, parsers, protocol boundaries, security invariants, caching, and concurrency that cannot be exercised reliably through Chrome. Do not optimize for test count or line coverage.
- Add a `.changes` fragment for user-visible behavior changes. Internal refactors, tests, and documentation-only changes do not require one.
- Preserve unrelated worktree changes and update focused documentation when behavior changes.

Run `npm test`, `npm run package`, and `git diff --check` before finishing. The E2E suite must load the real unpacked extension and exercise user journeys against its deterministic local provider. State clearly whether verification used a real model request.

## Releasing

- Treat a release as a separate, explicitly authorized operation. Never infer release intent from a request to commit, push, open a pull request, or merge.
- Before releasing, read the current release documentation and inspect the active publishing workflow instead of relying on remembered commands or triggers.
- Never change the package version, create or push a release tag, dispatch or approve a release workflow, or submit a store release unless the user explicitly asks to release a new version.
