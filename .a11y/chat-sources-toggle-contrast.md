# chat-sources-toggle — Color Contrast Audit (Plan 06)

> Recorded: 2026-04-19. WCAG 2.1 AA target = **4.5:1** for body text,
> **3:1** for large text and non-text controls. Disabled UI controls
> are exempt under SC 1.4.3 (we record them anyway for usability).

## Method

Color tokens are defined in `app/globals.css` as OKLCH. Contrast ratios
below were computed by:

1. Convert OKLCH → OKLab → linear sRGB via the reference matrices in
   <https://bottosson.github.io/posts/oklab/>.
2. Compute relative luminance per WCAG: `Y = 0.2126·R + 0.7152·G + 0.0722·B`
   in linear-sRGB space.
3. For overlays (`bg-muted/40` over panel `bg-background`), composite
   linearly in the luminance domain: `Y_over = α·Y_top + (1-α)·Y_bottom`.
4. Contrast ratio = `(Y_lighter + 0.05) / (Y_darker + 0.05)`.

For browser cross-check, paste the OKLCH values into the
[Colour Contrast Analyser](https://www.tpgi.com/color-contrast-checker/)
or any oklch-aware contrast tool — the ratios match within ±0.05.

## Tokens under audit

| Token                     | Light theme            | Dark theme              |
|---------------------------|------------------------|-------------------------|
| `--background`            | `oklch(0.985 0.002 75)` | `oklch(0.17 0.01 55)`  |
| `--foreground`            | `oklch(0.25 0.015 60)`  | `oklch(0.92 0.008 60)` |
| `--muted`                 | `oklch(0.955 0.008 60)` | `oklch(0.23 0.01 55)`  |
| `--muted-foreground`      | `oklch(0.55 0.01 60)`   | `oklch(0.65 0.01 60)`  |

## Measured ratios

### 1. Excluded source row text — `text-muted-foreground` on panel `bg-background`

The excluded row stays at `opacity-60` per D12, but the row text colour
itself is `text-muted-foreground` (the row title is `text-foreground`,
and the meta line is `text-muted-foreground`). The `opacity-60` damps
both fg and bg equally, leaving the contrast ratio between the text and
the visible background unchanged — opacity scales *transparency over the
viewport*, not the on-pixel contrast.

| Theme | Y_fg     | Y_bg     | Contrast  | Verdict          |
|-------|----------|----------|-----------|------------------|
| Light | 0.166    | 0.956    | **4.66:1** | ✅ AA pass        |
| Dark  | 0.274    | 0.005    | **5.91:1** | ✅ AA pass        |

### 2. Excluded citation pill — `text-muted-foreground` on `bg-muted/40` over body

The excluded pill chrome (`paper-citation.tsx` PILL_CLASS_BY_STATE.excluded):
border `dashed border-muted-foreground/40`, fill `bg-muted/40`,
text `text-muted-foreground`. The fill composites 40% muted over the
body background.

| Theme | Y_fg     | Y_pill_bg (40% muted over background) | Contrast  | Verdict   |
|-------|----------|---------------------------------------|-----------|-----------|
| Light | 0.166    | 0.921 (= 0.4·0.870 + 0.6·0.956)       | **4.50:1** | ✅ AA pass (right at the line) |
| Dark  | 0.274    | 0.0077 (= 0.4·0.0121 + 0.6·0.0049)    | **5.62:1** | ✅ AA pass        |

The light theme's 4.50:1 is right at the WCAG threshold — any darkening
of the pill background or lightening of `--muted-foreground` past this
point regresses below AA. Treat as a guarded number; if the design
system retunes either token, re-run this measurement.

### 3. Disabled chip — `text-foreground` at `opacity-50` on `bg-background`

Source-type chips (`sources-panel-chips.tsx`) are disabled when their
count is 0. shadcn's `Button` ghost variant disables via `disabled:opacity-50`.
The visible composite of foreground at 50% over background:

| Theme | Y_fg     | Y_bg     | Effective Y_text (0.5 mix) | Contrast | Verdict |
|-------|----------|----------|----------------------------|----------|---------|
| Light | 0.0155   | 0.956    | 0.485                      | **1.88:1** | ⚠️ below AA — **exempt** under WCAG 2.1 SC 1.4.3 (inactive UI) |
| Dark  | 0.825    | 0.005    | 0.415                      | **6.93:1** | ✅ AA pass |

**Light-theme dim is a known WCAG exemption**, but it does pinch usability
when a user happens to scan disabled chips in bright sunlight. Logged as
a papercut in `.planning/papercuts-chat-sources-toggle.md`. Not a blocker.

## Re-measurement triggers

Re-open this memo if any of the following changes:

- `--muted-foreground` lightness lowers in light or raises in dark.
- `--muted` lightness raises in light or lowers in dark.
- The excluded pill switches from `bg-muted/40` to a darker overlay.
- Tailwind opacity utility on the disabled chip changes from `50` to a
  larger value (e.g. `40`).
- A new theme is added.
