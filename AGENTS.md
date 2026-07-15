# AGENTS.md

This file gives coding agents the durable context needed to work on Transly.
Keep implementation details in the source, tests, and focused documentation so
this file does not become a second, stale specification.

## Product Scope

Transly is a local-first Chrome extension for:

- Article translation.
- Video subtitle translation.

Translation quality is the primary product requirement. Preserve meaning,
voice, terminology, links, and the document structure needed to render a clear
translation.

Do not add unrelated translation workflows unless the requested scope changes.

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
