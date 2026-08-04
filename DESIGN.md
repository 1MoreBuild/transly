---
version: "2.0"
name: Transly
description: Durable product design principles for translation across web content and video.
colors:
  ink: "#20201E"
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
  DEFAULT: 8px
components:
  primary-action:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.DEFAULT}"
  primary-action-hover:
    backgroundColor: "{colors.primary-hover}"
  owned-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  subtitle-overlay:
    backgroundColor: "{colors.subtitle-scrim}"
    textColor: "#FFFFFF"
    rounded: "{rounded.DEFAULT}"
---

## Purpose

This file defines how Transly should make design decisions when the code does not already provide the answer. It is not a component catalog or a record of the current implementation.

For general interface craft, use [`emil-design-eng`](https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng) and [`apple-design`](https://github.com/emilkowalski/skills/tree/main/skills/apple-design) when available. Use [`prototype`](https://github.com/emilkowalski/skills/tree/main/skills/prototype) for divergent exploration.

## Principles

### Content over chrome

The translated content is the product. Transly should help people read and watch without making its own interface the center of attention. Remove controls, decoration, and explanation that do not improve the current task.

### Context before fragments

Optimize for meaning, voice, and continuity across the whole work. Do not trade translation quality for implementation convenience by treating every visible string as an isolated unit.

### Preserve the host

Translation should add understanding without redesigning the source. Preserve hierarchy, relationships, links, lists, tables, code, formulas, timing, and other semantic structure. Adapt to the host where that improves continuity; establish a neutral Transly surface only where Transly owns the experience.

### Yellow marks commitment

Yellow is Transly's brand color and a promise of action. Reserve it for the primary choice that changes content or confirms a consequential setup step. Do not use it as ambient decoration. Status colors must describe status, not brand.

### Show useful progress

Return complete, meaningful units as soon as they are trustworthy. Do not reveal partial tokens or stage artificial progress. Preserve finished work while the rest continues, and never make users wait for unrelated content before they can read.

### Failure is local and recoverable

A failure should explain what stopped, retain completed work, and offer a clear next step. Do not scar the source page with diagnostic styling, erase useful results, or require a reload when a retry can recover.

### Defaults carry the product

The common path should work without understanding providers, protocols, typography, or layout mechanics. Add controls only when user intent or viewing conditions genuinely differ. Keep advanced configuration available but subordinate.

### One surface, one next action

Every state should make the next useful action obvious. Visual hierarchy follows user intent: one primary action, supporting choices, then diagnostics. Stable placement matters more than novelty.

### Readability beats visual fidelity

Respect the source style until it harms translation readability. When scripts, line lengths, contrast, or video composition create a conflict, choose comfortable reading while preserving the source's hierarchy and tone.

## Review Questions

Before shipping a design change, ask:

- Does it improve reading, watching, or recovery rather than merely expose implementation?
- Does the translation still belong to the source while remaining easy to distinguish?
- Is yellow reserved for the most consequential action?
- Can users understand the current state and recover without losing completed work?
- Is every new setting necessary, or should a better default remove it?
- Would this principle still make sense if the component library, provider, or supported site changed?
