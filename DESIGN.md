---
version: "1.1"
name: Transly
description: Product-specific visual rules for Transly's extension surfaces and injected translations.
colors:
  ink: "#20201E"
  line: "#E7E5E0"
  surface: "#FFFFFF"
  primary: "#FFC41A"
  primary-hover: "#F5B900"
  subtitle-scrim: "rgba(0, 0, 0, 0.76)"
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: "400"
    lineHeight: 18px
    letterSpacing: 0
  control:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: "650"
    lineHeight: 16px
    letterSpacing: 0
rounded:
  sm: 7px
  DEFAULT: 8px
spacing:
  unit: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  primary-action:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.DEFAULT}"
    height: 44px
    padding: 0 16px
  primary-action-hover:
    backgroundColor: "{colors.primary-hover}"
  owned-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
  subtitle-overlay:
    backgroundColor: "{colors.subtitle-scrim}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: 10px 18px
---

## Purpose

This file records decisions unique to Transly. Do not expand it into a general UI handbook.

For general interface craft, use [`emil-design-eng`](https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng) and [`apple-design`](https://github.com/emilkowalski/skills/tree/main/skills/apple-design) when available. Use [`prototype`](https://github.com/emilkowalski/skills/tree/main/skills/prototype) for divergent visual exploration. Existing project conventions remain the fallback when those skills are unavailable.

## Brand Direction

Transly uses **Action Yellow**: yellow is the brand color, concentrated on the single primary action that changes the page. The surrounding interface stays white, near-black, and neutral gray.

- Use `{colors.primary}` for Translate, Connect, or Save.
- Never use yellow as an ambient tint, section background, or decoration.
- Use green and red only for semantic status.
- Avoid beige, gradients, decorative blobs, and card-heavy layouts.

## Owned Surfaces

The popup and settings page use the tokens above. They should feel like compact browser utilities, not marketing pages.

### Popup

- Keep the popup 352px wide.
- Do not add a branded header; Chrome already identifies the extension.
- Order the surface as target language, provider/model, then the primary action.
- Once translated, change the primary action to Restore instead of adding a separate Clear section.
- Keep API URLs, keys, and provider internals behind settings.
- Show the provider icon, model, provider name, and specific readiness state. Prefer “Lane is offline” over “Unavailable.”

### Settings

- Use one column with a maximum width of 760px.
- Put common connection choices first and protocol details under Advanced.
- Use Base UI for selects and comboboxes.
- Place errors beside the action or field that caused them.

## Injected Article Content

Injected content belongs visually to the host page, not to Transly's popup.

- Inherit the source element's readable color, size, weight, line height, alignment, and link style.
- Use a system sans-serif fallback for translated CJK text; never introduce a serif translation font.
- Keep each translation closer to its source than to the next source block.
- Preserve semantic structure: headings, lists, tables, links, emphasis, code, and formulas.
- Never change host grid tracks, width, display mode, or table-cell layout.
- Put compact loading feedback exactly where the translation will appear.
- Show complete passages as each model batch finishes. Do not reveal tokens or replay already-complete paragraphs one by one.
- Keep model failures out of page content; explain recovery in the popup.

## YouTube Subtitles

YouTube is the only supported video surface for now.

- Put the Transly control beside YouTube's controls in its own button boundary.
- Keep subtitles centered near the lower safe area and above visible player controls.
- Support source only, translation only, and bilingual display.
- In bilingual mode, support source-first and translation-first order.
- Let users adjust source size, translation size, vertical position, and scrim opacity independently using explicit pixel values where applicable.
- The player entry point may use the Transly mark; subtitle text and scrim must remain unbranded.

## Product Feedback

- Use inline feedback instead of toasts or red outlines injected into the page.
- Preserve a retry path after provider failures without requiring a page reload.
- Keep controls stable in size across idle, loading, success, and error states.
