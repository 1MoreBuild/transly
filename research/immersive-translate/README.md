# Immersive Translate Local Snapshot

This directory keeps a local snapshot of the Chrome-installed Immersive Translate extension for reverse-engineering notes.

## Snapshot

- Extension ID: `bpoadfkcbjbfhfodiogcnhhhpibjhbnh`
- Version: `1.30.3`
- Source Chrome path: the current user's Chrome extension profile.
- Local snapshot: `research/immersive-translate/1.30.3_0`
- Snapshot date: `2026-06-30`

## Important Files

- `1.30.3_0/manifest.json`: MV3 manifest, permissions, content script entrypoints.
- `1.30.3_0/content_guard.js`: early loader and iframe guard.
- `1.30.3_0/content_main.js`: main minified content runtime for page translation, dynamic DOM observation, subtitle orchestration, popup command handling.
- `1.30.3_0/default_config.content.json`: content-side defaults and rules. This is the most useful readable input.
- `1.30.3_0/default_config.json`: broader product/service configuration.
- `1.30.3_0/video-subtitle/inject.js`: page-world subtitle request hook.
- `1.30.3_0/styles/inject.css`: injected bilingual translation styles.

## Boundary

This snapshot is for local analysis only. Do not copy proprietary source, bundled assets, service adapters, UI, or naming into our extension. Use it to understand architecture and behavior, then implement our own small article/subtitle translator independently.

## Useful Commands

Extract readable snippets around symbols from minified bundles:

```bash
node tools/extract-immersive-snippets.mjs content_main.js MutationObserver subtitleRule contextReqLength
node tools/extract-immersive-snippets.mjs video-subtitle/inject.js fetch XMLHttpRequest postMessage
```

Inspect key content config:

```bash
node -e 'const c=require("./research/immersive-translate/1.30.3_0/default_config.content.json"); console.log(c.generalRule.bodyRule)'
```
