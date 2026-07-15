# Article Rendering and Prompt Notes

Snapshot inspected: Immersive Translate 1.30.3.

This note records observed behavior and architecture for independent implementation. It does not copy product code into Transly.

## 1. Typography inheritance

The translation renderer does not apply a global article font size, weight, line height, or color.

- `styles/inject.css` only resets `font-feature-settings` on the target wrapper.
- The default target wrapper tag is `font`; the default block prefix/suffix mode is `smart`.
- The minified renderer builds an outer target wrapper and inserts it into the paragraph's `commonAncestorContainer` alongside the original text nodes. For a heading, that container is normally the `h1`/`h2` itself.
- A block translation gets a `<br>` followed by nested target wrapper elements. Because those elements live inside the heading, they inherit the heading's color, font size, weight, line height, and alignment.

Relevant bundle functions: `Sv`, `Jv`, `cu`, and `k4` in `content_main.js`.

An earlier Transly renderer inserted `.transly-translation` after the source element without copying its computed typography. That made an `h1` translation resolve styles from the heading's parent. The current independent renderer still uses a sibling to avoid mutating reactive source DOM, but explicitly copies a safe typography subset from the source element while retaining a readable CJK sans-serif family.

## 2. Bilingual spacing

The default dual-mode block wrapper uses:

```css
[imt-state="dual"] .immersive-translate-target-translation-block-wrapper {
  margin: 8px 0 !important;
  display: inline-block;
}
```

For block content, the `smart` wrapper prefix inserts a line break before the target wrapper. Translation-only mode removes that visual separation and sets the block margin to zero.

The important design property is that the original block's own margin is not redistributed. The source and translation form one visual paragraph inside the original semantic container; the target wrapper owns the local source-to-translation gap.

An earlier Transly implementation changed the source element's inline `margin-bottom`, kept only a small local gap, and moved the remainder to the translation sibling. The current renderer no longer rewrites source margins. The translation wrapper owns the source-to-translation gap and mirrors enough of the source block's bottom spacing to keep the bilingual pair visually grouped.

## 3. Default AI translation prompt

The default AI service frames the model as a native translator in the target language and explicitly asks for fluent output. Its main constraints are:

- output translation only;
- keep the same paragraph count and format;
- place HTML tags where they belong while preserving fluency;
- preserve proper nouns, code, and other content that should not be translated;
- use `%%` only as a multi-paragraph separator.

The prompt can also receive:

- document title;
- an article or subtitle summary (`theme`);
- a style guide;
- required terminology and optional domain conditions.

The title is populated from the page title unless the URL is blocked. Summary/style-guide context is injected when AI context is enabled and an article context object is available. The extension UI exposes AI context as an optional feature for supported services. AI Expert definitions are selected dynamically; their full definitions are not present in this local extension snapshot.

The default AI request batches multiple paragraphs with a plain separator. Many provider configs default to four paragraphs per request. The output parser splits by the same separator and validates item count.

Relevant config: `translationServices.ai` in `default_config.content.json`. Relevant bundle paths: `qD` (title/environment), `_translate` (prompt selection and interpolation), and `mse` (summary/style guide/terms).

## 4. Transly alignment

The current independent implementation applies the useful behavioral lessons without copying the extension's code:

1. Translation requests frame the model as a target-language-native editorial translator and explicitly allow natural clause reordering while preserving facts, nuance, terminology, and author voice.
2. The model receives plain ordered article context for meaning, then only the current batch as text to translate. URLs, DOM selectors, internal IDs, and transport objects are excluded from translation input.
3. The response contract is a minimal ordered JSON string array. Internal IDs are mapped back in code, and item count plus placeholder integrity are validated before rendering.
4. Batches are derived from character and item budgets without a fixed batch-count cap. Every batch shares the same capped article context.
5. Translations remain outside source DOM, copy source typography safely, keep a product-level CJK sans-serif choice, and own their spacing without rewriting source margins.

A concise document brief or terminology guide can be added later when it contributes information. It should not require a second model request merely to summarize a short article.
