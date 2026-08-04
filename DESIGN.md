---
version: "1.0"
name: Transly
description: Calm, context-preserving translation interfaces that feel native to Chrome and to the page they augment.
colors:
  ink: "#20201E"
  muted: "#6F6D67"
  line: "#E7E5E0"
  surface: "#FFFFFF"
  surface-raised: "#F6F5F2"
  surface-hover: "#EFEFEC"
  primary: "#FFC41A"
  primary-hover: "#F5B900"
  success: "#16834D"
  danger: "#C6352B"
  on-dark: "#FFFFFF"
  subtitle-scrim: "rgba(0, 0, 0, 0.76)"
typography:
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 18px
    fontWeight: "700"
    lineHeight: 23px
    letterSpacing: 0
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: "400"
    lineHeight: 18px
    letterSpacing: 0
  body-large:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 15px
    fontWeight: "400"
    lineHeight: 22px
    letterSpacing: 0
  control:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: "650"
    lineHeight: 16px
    letterSpacing: 0
  caption:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 11px
    fontWeight: "600"
    lineHeight: 15px
    letterSpacing: 0
  subtitle-source:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 25px
    fontWeight: "400"
    lineHeight: 34px
    letterSpacing: 0
  subtitle-translation:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 30px
    fontWeight: "600"
    lineHeight: 40px
    letterSpacing: 0
rounded:
  xs: 6px
  sm: 7px
  DEFAULT: 8px
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  popup-inline: 16px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.DEFAULT}"
    height: 44px
    padding: 0 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.DEFAULT}"
    height: 40px
    padding: 0 14px
  icon-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    width: 34px
    height: 34px
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-large}"
    rounded: "{rounded.sm}"
    height: 48px
    padding: 0 14px
  select-popover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.DEFAULT}"
    padding: 6px
  subtitle-overlay:
    backgroundColor: "{colors.subtitle-scrim}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.xs}"
    padding: 10px 18px
  selected-item:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 8px 10px
  supporting-text:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
  status-ready:
    textColor: "{colors.success}"
    typography: "{typography.body}"
  status-error:
    textColor: "{colors.danger}"
    typography: "{typography.body}"
---

## Overview

Transly should feel calm, precise, and trustworthy. It is a translation tool, not a dashboard and not a marketing site. The interface should help people choose a language, choose a model, and translate without making the configuration machinery feel more important than the content.

The visual character is quiet utility: white surfaces, near-black type, restrained gray structure, and one warm yellow action color. Yellow is Transly's brand color, expressed through the primary action rather than ambient tinting or decorative fields. Craft comes from alignment, spacing, typography, and response rather than decoration. The intended feeling is confidence, not novelty.

This document is normative for surfaces owned by Transly: the extension popup, settings, menus, loading and error states, and YouTube subtitle controls. Injected article translations and player overlays must adapt to their host context. Never force the popup's palette or layout onto a webpage.

## Colors

- **Ink and white carry the interface.** Use `{colors.ink}` for primary text and `{colors.surface}` for owned surfaces.
- **Yellow is the brand, expressed through action.** Reserve `{colors.primary}` for the primary commit action, such as Translate, Connect, or Save. Concentrating yellow in one meaningful control makes the brand recognizable without making the interface noisy. Do not use it as ambient tinting, general decoration, or a section background.
- **Gray creates hierarchy.** Use `{colors.muted}` for supporting and disabled text, and `{colors.line}` for structural separators. Disabled controls also reduce opacity while retaining readable contrast.
- **Status colors are semantic.** Green means ready or successful. Red means an actionable error. Pair color with plain text or an icon; never rely on a colored dot alone.
- **Article translations do not use brand colors.** They inherit the host page's readable foreground, link colors, and emphasis.
- **Video is a dark context.** Subtitle text is white over a user-adjustable black scrim. The scrim exists for legibility, not visual branding.

Avoid beige, cream, large tinted regions, gradients, decorative color blobs, and single-hue screens. Transly's identity should still work when the yellow accent is absent.

## Typography

Use the platform system font for all extension-owned interfaces. It is familiar, compact, and optimized for the operating system. Do not introduce a display font.

- Use `title` only for compact surface titles. The popup normally does not need a branded header.
- Use `body` for status and supporting text, `body-large` for settings inputs, `control` for buttons and selected values, and `caption` for short labels.
- Use weight and spacing to establish hierarchy. Do not solve every hierarchy problem by increasing font size.
- Keep letter spacing at `0`. Never use negative tracking in compact tools.
- Extension UI and inserted translations must not use serif type. For translated CJK text, use a system CJK sans-serif fallback while preserving the source element's size, weight, color, line height, and alignment.
- Subtitle sizes are explicit pixel values because users adjust them against a video frame. Defaults are 25px for the source and 30px for the translation, with independent controls.

## Layout

Use a 4px unit and an 8px visual rhythm. Prefer 8, 12, 16, 24, and 32px spacing. Every gap must communicate grouping.

### Popup

- Keep the popup a stable 352px wide. It is a compact control surface, not a settings page.
- Put the target language first, the active provider and model second, and the primary translation action last.
- Show one primary action. Once an article is translated, that action becomes Restore rather than adding a separate Clear section.
- Keep configuration behind an explicit settings icon. Do not expose API URLs, keys, provider internals, or setup prose in the normal translation path.
- Avoid a product header when the browser already identifies the extension. Start with the task.

### Settings

- Use one readable column with a maximum width of 760px.
- Present common setup choices first. Put protocol and provider-specific controls under Advanced.
- Place validation and status next to the control or action that caused them. Do not collect unrelated messages in a global banner.
- Do not put cards inside cards. Use whitespace and thin separators for page structure.

### Injected article content

- The source and its translation form one visual group. Keep a small gap between them and a larger gap before the next source block.
- Insert translations inside the relevant semantic structure. Preserve lists, tables, headings, links, emphasis, and code rather than flattening them into paragraphs.
- Do not change the width, grid tracks, alignment, or display mode of the host element. A translation must not create a new column or shrink a table cell.
- Loading belongs exactly where the translation will appear. It must be compact and must not create a large blank region.

### YouTube subtitles

- The Transly control lives beside YouTube's controls but in its own button boundary. Match YouTube's control height and interaction behavior without pretending to be a native YouTube control.
- Keep subtitles near the lower safe area of the video and above visible player controls. Center them horizontally and limit their width to avoid edge collisions.
- Support source only, translation only, and both. In bilingual mode, support source-first and translation-first order.
- Keep source size, translation size, vertical position, and scrim opacity independently adjustable.
- YouTube is the only supported video integration for now. Do not inject video controls into other sites until their player behavior has been designed and tested.

## Elevation & Depth

Transly is mostly flat. Owned sections sit directly on the page or popup surface. Use borders and spacing before shadows.

- Popovers may use one soft shadow to separate them from the triggering surface.
- Popovers must originate from their trigger through Base UI's transform origin.
- Do not float page sections as decorative cards.
- The subtitle scrim is a functional contrast layer. It should not resemble a raised card and should remain visually subordinate to the video.
- Avoid blur and translucency in the popup and settings. They reduce contrast without improving hierarchy in these small utility surfaces.

## Shapes

Use radii of 6–8px for controls and popovers. Reserve fully rounded shapes for status dots, switches, and true pills.

- Buttons are compact rectangles, not capsules.
- Icon controls use stable square dimensions so hover and loading states never shift nearby content.
- Familiar actions use familiar symbols from the existing icon library. Do not draw one-off SVG controls when a standard icon exists.
- The Transly logo is branding, not a general action icon. Use it for the extension identity and the distinct YouTube entry point only.

## Components

### Primary actions

Primary buttons use the yellow accent, near-black text, a 44px height, and an 8px radius. They need an immediate pressed state such as `scale(0.97)`. Disabled buttons keep their dimensions and clearly reduce contrast.

There must be only one yellow primary action in a view. Secondary commands use neutral surfaces or icon buttons.

### Selects and comboboxes

Use Base UI for popup and settings selects. The trigger shows the current value and a chevron. The popup is anchored to the trigger, matches its usable width when practical, and scrolls internally instead of overflowing the extension viewport.

Selected items use a check icon and a subtle neutral background. Language names must stay on one line. Model lists may be searchable when the provider returns many models.

### Provider identity

Show the provider icon, model name, provider name, and readiness. The model is the primary value. Do not show the API base URL in the popup. A specific failure such as “Lane is offline” is better than “Unavailable.”

### Feedback and loading

Use inline feedback, not disruptive toasts. Errors should explain what failed and the next useful action. Do not use red dashed outlines around arbitrary page content as the user-facing error state.

Article results appear by complete passage as each model batch finishes. Do not stream token by token or artificially reveal one paragraph at a time after a batch is already complete.

Loading indicators are compact, continuous, and non-blocking. The interface must remain interruptible; Restore and retry paths should never wait for an unrelated animation.

### Motion

Motion explains state or spatial origin. It is not decoration.

- Give pointer presses immediate visual feedback.
- Use a strong ease-out curve such as `cubic-bezier(0.23, 1, 0.32, 1)` for small entrances.
- Keep select and popover transitions between 120ms and 180ms. Start near the final state, such as `scale(0.98)` with opacity, never `scale(0)`.
- Animate only `transform` and `opacity` in interaction paths.
- Do not animate keyboard-triggered actions or high-frequency navigation.
- Respect `prefers-reduced-motion`; remove scale and movement while retaining short opacity or color feedback.

### Accessibility

- Every control must have a visible keyboard focus state and an accessible name.
- Use at least a 34px pointer target in compact toolbars and 44px for primary actions.
- Preserve readable contrast in default, hover, disabled, success, and error states.
- Keep text inside controls at all supported languages and browser zoom levels. Wrap labels only when the control is designed to grow vertically.
- Do not encode state through color alone.
- Respect reduced motion, increased contrast, and reduced transparency preferences where the platform exposes them.

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| Make translation the obvious first action. | Lead with branding, setup prose, or provider internals. |
| Use one yellow primary action. | Scatter yellow across decorative elements. |
| Inherit article typography and link styling. | Apply popup colors or a generic blue to translated text. |
| Keep source and translation visually grouped. | Place a translation closer to the next source paragraph. |
| Preserve lists, tables, headings, links, and code. | Flatten semantic content into plain paragraphs. |
| Show a precise inline recovery action. | Use vague status text or a disruptive toast. |
| Anchor popovers to their trigger. | Open menus from an arbitrary center point. |
| Reveal complete passages as batches finish. | Stream tokens or delay already-complete paragraphs. |
| Put subtitle controls in the YouTube player. | Require the extension popup for normal subtitle use. |
| Use restrained 6–8px radii. | Turn every text control into a pill. |
| Test the 352px popup, responsive settings, article pages, tables, and YouTube. | Approve a visual change from an isolated component preview alone. |

Before merging visual work, verify keyboard operation, long language and model names, 200% zoom, dark host pages, article structure, subtitle safe-area placement, and reduced motion. A screenshot is evidence, not the whole review: interaction and layout stability must also be exercised.
