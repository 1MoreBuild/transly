# Content Detection

The article path is AI-assisted and intentionally avoids a large site-specific selector table.

## Browser Responsibilities

JavaScript performs only the work that must happen locally:

- Reject scripts, forms, navigation, hidden content, editable regions, code, and extension UI.
- Collect visible text blocks and lightweight geometry/ancestor metadata.
- Preserve links and protected inline nodes through placeholders.
- Keep blocks in document order and enforce payload limits.

## Model Responsibilities

The AI audit decides whether visible candidates are article content, missing translations, broken translations, navigation, recommendations, ads, or UI. The browser applies only actions that reference known candidate IDs.

## Generic Hints

Container names such as `article`, `main`, `.post-content`, `.entry-content`, `.markdown-body`, and `.prose` are scoring hints rather than hard site rules. Generic text leaves are still available to the audit when semantic containers are absent.

## Subtitle Detection

The subtitle page hook is injected only after the user enables subtitles. Current resource patterns are:

- YouTube `/api/timedtext`
- `.vtt` and `.webvtt`
- Bilibili `aisubtitle.hdslb.com/bfs`

Additional formats should be driven by observed failures, not copied rule libraries.
