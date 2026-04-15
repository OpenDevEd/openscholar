---
phase: 99-selection-basket-core
plan: 02
subsystem: ui
tags: [sheet-drawer, accordion, i18n, zustand, lucide, radix]

# Dependency graph
requires:
  - 99-01 (useExtractionBasketStore, BasketEntry, BasketSource)
provides:
  - ExtractionBasketDrawer Sheet-based drawer shell with header, scrollable body, and footer CTA
  - BasketTriggerButton icon button with count badge overlay and hydration gate
  - BasketPaperRow per-paper row with title, DOI, source badge, and remove action
  - BasketSourceSection Accordion-based collapsible per-source group with count
  - BasketEmptyState FlaskConical empty state with guidance copy
  - extraction.basket.* i18n keys in all 6 locales (en-US, en-GB, fr, ja, zh, hi)
affects: [102 (AddToExtractionButton mount point), 103 (selector tabs)]

# Tech tracking
tech-stack:
  added: []
  patterns: [Sheet drawer with sticky header/footer and ScrollArea body, Accordion type=multiple for per-source collapsible groups, hydration gate for SSR-safe badge count]

key-files:
  created:
    - components/extraction/extraction-basket-drawer.tsx
    - components/extraction/basket-trigger-button.tsx
    - components/extraction/basket-paper-row.tsx
    - components/extraction/basket-source-section.tsx
    - components/extraction/basket-empty-state.tsx
  modified:
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/ja.json
    - messages/zh.json
    - messages/hi.json

key-decisions:
  - "Accordion type=multiple with all sections defaultValue expanded for immediate paper visibility"
  - "Hydration gate renders null (not empty state) before store rehydrates to prevent layout flash"
  - "handleCTA navigates then closes drawer (not the reverse) for cleaner UX transition"
  - "French locale uses proper Unicode diacritics for accented characters"

requirements-completed: [SEL-09, SEL-10]

# Metrics
duration: 5min
completed: 2026-04-15
---

# Phase 99 Plan 02: Extraction Basket Drawer UI Summary

**Sheet-based drawer with per-source Accordion breakdown, paper rows with remove action, trigger button with count badge, empty state, and i18n keys in 6 locales**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-15T17:09:29Z
- **Completed:** 2026-04-15T17:14:26Z
- **Tasks:** 3 (2 auto + 1 checkpoint auto-approved)
- **Files created:** 5
- **Files modified:** 6

## Accomplishments
- ExtractionBasketDrawer: Sheet side="right" with sticky header (paper count in text-primary), ScrollArea body grouping papers by source via Accordion, sticky footer with "Review & start extraction" CTA disabled when empty
- BasketTriggerButton: outline icon button with FlaskConical, absolute-positioned count Badge overlay ("9+" for >9), hydration gate prevents flash of 0
- BasketPaperRow: flex row with truncated title, conditional DOI, secondary source Badge, ghost remove button with hover:text-destructive and Tooltip
- BasketSourceSection: AccordionItem wrapping AccordionTrigger (source label + count) and AccordionContent (list of BasketPaperRow)
- BasketEmptyState: centered FlaskConical at size-12 with muted foreground, heading and body guidance copy
- All 6 locale files (en-US, en-GB, fr, ja, zh, hi) seeded with 11 extraction.basket.* keys + 5 sourceLabel sub-keys

## Task Commits

Each task was committed atomically:

1. **Task 1: Basket sub-components** - `f67d656` (feat) -- 4 files: BasketPaperRow, BasketSourceSection, BasketEmptyState, BasketTriggerButton
2. **Task 2: ExtractionBasketDrawer shell + i18n** - `25363b7` (feat) -- drawer component + 6 locale files updated

## Files Created/Modified
- `components/extraction/basket-paper-row.tsx` - Per-paper row with title, DOI, source badge, remove button
- `components/extraction/basket-source-section.tsx` - Accordion-based collapsible per-source group
- `components/extraction/basket-empty-state.tsx` - FlaskConical empty state with guidance copy
- `components/extraction/basket-trigger-button.tsx` - Icon button with count badge overlay
- `components/extraction/extraction-basket-drawer.tsx` - Sheet drawer shell with header, ScrollArea, footer CTA
- `messages/en-US.json` - Added extraction.basket.* i18n keys
- `messages/en-GB.json` - Added extraction.basket.* i18n keys
- `messages/fr.json` - Added extraction.basket.* i18n keys (with proper French diacritics)
- `messages/ja.json` - Added extraction.basket.* i18n keys (Japanese)
- `messages/zh.json` - Added extraction.basket.* i18n keys (Chinese)
- `messages/hi.json` - Added extraction.basket.* i18n keys (Hindi)

## Decisions Made
- Accordion type="multiple" with defaultValue set to all source keys so all sections start expanded
- Hydration gate renders null (not empty state) while store rehydrates -- prevents flash-of-empty before sessionStorage loads
- CTA handler calls router.push then onClose for a cleaner navigation experience
- French locale uses proper Unicode escapes for diacritics (e-acute, e-grave, a-grave)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 5 drawer components ready for Phase 102 (mount BasketTriggerButton in app shell)
- ExtractionBasketDrawer controlled via isOpen/onClose props -- Phase 102 decides where to wire the state toggle
- i18n keys ready for Phase 103 selector tabs (alreadyInBasket key available)
- 29 existing tests from Plan 01 provide regression safety

## Self-Check: PASSED

---
*Phase: 99-selection-basket-core*
*Completed: 2026-04-15*
