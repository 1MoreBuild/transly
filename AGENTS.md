# AGENTS.md

This file gives agents the durable context needed to install or work on Transly.
Keep implementation details in the source, tests, and focused documentation so
this file does not become a second, stale specification.

## Product Scope

Transly is a local-first Chrome extension for:

- Article translation.
- Video subtitle translation as a beta feature.

Translation quality is the primary product requirement. Preserve meaning,
voice, terminology, links, and the document structure needed to render a clear
translation.

Do not add unrelated translation workflows unless the requested scope changes.

## Installing Transly For A User

When the user asks to install or set up Transly:

1. Read the Install Transly section in `README.md` and inspect the current
   worktree before taking action.
2. Use the current checkout when available. Otherwise ask the user where to
   clone the repository; do not assume a home-directory workspace.
3. Do not edit product source as part of a normal installation.
4. Run `npm install`, then `npm run setup`. Let the command report missing
   macOS, Chrome, Node.js, or Codex login requirements instead of guessing.
5. Run `npm test` after setup. Do not run `native:smoke` or any other real model
   request without explicit user approval because it consumes subscription
   capacity.
6. Do not install the extension through browser automation. Return the
   repository root's exact absolute path and ask the user to open
   `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
   select that folder.
7. Report completed checks, manual steps, and whether any model request ran.

## Sources Of Truth

Start with:

- `README.md` for installation, usage, and commands.
- `docs/architecture.md` for components, trust boundaries, and request flow.
- `docs/site-rules.md` for article discovery and extraction behavior.
- The relevant source and tests for current implementation details.

Code and tests are authoritative. When behavior changes, update the focused
document that owns it instead of copying the new details into this file.

## Durable Boundaries

- Codex and ChatGPT credentials stay inside the Native Host. Browser extension
  code must never read or receive them.
- Chrome Native Messaging is the browser-to-host transport. Do not expose model
  access through a localhost HTTP server.
- Langfuse is optional. Translation must work when it is absent or
  misconfigured, and credentials must never appear in traces or logs.
- Transly is an independent implementation. Do not commit extracted proprietary
  extension bundles, source, assets, branding, or text.
- Preserve unrelated user changes in the worktree.

## Working On A Change

1. Read the relevant code, tests, and focused documentation before editing.
2. Make the smallest cohesive change that solves the requested behavior.
3. Add or update tests in proportion to the risk.
4. Update the owning documentation when architecture or user behavior changes.
5. Report whether verification used a real model request, since it consumes the
   user's subscription capacity.

Useful checks:

```bash
npm test
npm run preflight
npm run native:doctor
npm run logs -- --limit 80
git diff --check
```

See `README.md` for setup, smoke tests, and the complete command list.

## Definition Of Done

A change is complete when the requested path works through the real extension,
relevant tests pass, security and translation quality have not regressed, and
the documentation still matches user-visible behavior.
