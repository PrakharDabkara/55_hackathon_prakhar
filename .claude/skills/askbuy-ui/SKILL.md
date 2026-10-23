---
name: askbuy-ui
description: AskBuy's Parchi design rules for the React app. Use when writing or changing any component, screen, style or UI copy under apps/web, including the shop app. Covers tokens, fonts, paper colours, tap targets, focus rings, themes, widths, states, motion, copy and where the parchi (paper) look is allowed.
paths:
  - apps/web/**
---

# Parchi design rules

The tokens are in `apps/web/src/design/tokens.css` (ADR-0041); `tokens.test.ts` checks contrast. Read the file for current values.

## Tokens and type

- Colours, spacing, radius, type and motion come **only from tokens**. No hex values, and no raw px for spacing, in components.
- **Mukta** (`--font-ui`) for all UI text. **Kalam** (`--font-hand`) only inside a parchi. No other font.
- Marigold is for the one primary button per screen. It is never used for text.

## Paper

- The parchi (paper, handwriting, stamps) appears **only on request cards and on packing slips** (order cards with 2+ lines). Nothing else imitates paper.
- Paper colours are **locked**: `--paper`, `--paper-edge`, `--paper-ink`, `--paper-ink-muted` and the stamp colours stay light paper in the dark theme (at most slightly dimmed). Use `--paper-ink` for text on paper, never `--ink` (it turns light in the dark theme).
- Focus on paper uses `--focus-on-paper`; on the dark status card, `--focus-on-dark`. The default `--focus` (brand) is too weak on those surfaces.

## Targets, focus, contrast

- Tap targets ≥ 48 px (`--tap`); 44 px is the absolute floor.
- Every interactive element has a visible focus ring: 2 px `--focus`, 2 px offset. The ring must be at least **3:1** against the surface it sits on, in both themes.
- Text contrast AA: 4.5:1, or 3:1 at 24 px and up, in both themes.

## Layout and themes

- **360 px first.** Every screen also works at 1280 px: a centered column, max-width 480 px for the shop app.
- Three theme paths must all work: light, dark by `prefers-color-scheme`, and the chosen `data-theme='light'|'dark'` on the root. The two dark token blocks must stay equal (a new dark token goes in both).

## States and motion

- Every screen has designed **empty, loading (skeletons; no spinner over content), error-with-retry and offline** states.
- Motion ≤ 200 ms (`--motion`). Under `prefers-reduced-motion`, no movement: fade or instant.

## Dialogs

- **No browser dialogs**: no `alert`, `confirm`, `prompt`. Use an in-app sheet (the confirm sheet pattern, e.g. "Log out on all devices").

## Copy

- English UI copy: plain, short, verbs on buttons, errors say what to do. **No Hinglish in the `en` table.** Keep the `hi` table in parity (`strings.test.ts` checks it); `en` is the default language.
- Brand name only from `BRAND_NAME` (one constant). In the shop app it appears on login and as "Powered by" in the sidebar, nowhere else.

## Privacy in the shop app

- The shop app never shows customer identity: no name, phone, raw query text or address before an order is ACCEPTED.
