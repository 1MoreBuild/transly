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

The subtitle runtime currently activates only on YouTube and YouTube No-Cookie
pages. Its page hook is injected at `document_start` in every frame so it can
retain subtitle responses that arrive before the user opens the popup. The
runtime then consumes those captures only when subtitles are enabled. Supported
input paths are:

- YouTube `/api/timedtext` JSON3 or XML, including an explicit CC trigger when
  captions have not been requested yet.
- `.vtt`, `.webvtt`, and `.srt` URLs, plus `text/vtt` and SubRip response types.
- Native `video.textTracks`, including dynamic cues and initially disabled
  subtitle tracks. Transly restores the original track mode when disabled.

The subtitle runtime also mounts a dedicated Transly control next to YouTube's
right control group without inserting it into YouTube's own button container.
The control toggles translated subtitles directly and exposes persisted display
mode, bilingual line order, independent original and translation text sizes,
vertical position, and background opacity settings. The default presentation is
bottom-centered with a 6% video-height inset; users can move it when it obscures
important on-screen content. The overlay temporarily moves above the player
controls while they are visible, then returns to the lower reading position
when the controls hide.

Before translation, chronological cues are grouped into short utterances using
sentence endings, pauses, duration, and size limits. Whole groups are prioritized
near the current playback position and packed into bounded requests without
reordering their cues. The model receives nearby transcript context, translates
each group as one thought, and returns exactly one line for every original timed
cue. Transly keeps the player's original cue timestamps; it does not synthesize
word-level timing.

Additional formats should be driven by observed failures, not copied rule libraries.
