# Phase 99: Selection Basket Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 99-selection-basket-core
**Mode:** --auto (all decisions auto-selected)
**Areas discussed:** Store architecture, Basket data shape, Drawer content layout, Already-in-basket indicator style

---

## Store Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated file `lib/store/extraction-basket.ts` | Separate file following `createSidebarStore` factory pattern; keeps 42KB `lib/store.ts` untouched | ✓ |
| Add to existing `lib/store.ts` | Extend the monolithic store file with a new basket slice | |
| Collocate with extraction feature `components/extraction/basket-store.ts` | Keep store close to its primary consumer | |

**User's choice:** [auto] Dedicated file — `lib/store.ts` is already 42KB; a dedicated file follows the `createSidebarStore` factory pattern and keeps the basket self-contained for downstream phases.
**Notes:** sessionStorage-backed via `createJSONStorage(() => sessionStorage)` — first sessionStorage store in codebase. Cleared only on successful job creation.

---

## Basket Data Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Rich entry (ID + title + DOI + source + addedAt) | Stores enough metadata to render the drawer without re-fetching | ✓ |
| Minimal entry (ID + source only) | Smaller storage footprint but requires re-fetch for display | |
| ID-only Set | Simplest but loses source provenance and requires lookup for every display | |

**User's choice:** [auto] Rich entry — the drawer needs to display paper titles for review, and source origin enables the per-source breakdown required by SEL-09; avoids a re-fetch round-trip when the drawer opens.
**Notes:** Map<string, BasketEntry> keyed by normalized OpenAlex ID. Dedupe at Map level — add is idempotent.

---

## Drawer Content Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Per-source grouped sections | Collapsible headers per source (Library, Search, Manual, etc.) with section counts | ✓ |
| Flat chronological list | Papers listed in add-order regardless of source | |
| Summary-only (no paper list) | Just counts and breakdown, paper list deferred to `/extraction/new` | |

**User's choice:** [auto] Per-source grouped sections — SEL-09 requires per-source breakdown; grouping by source gives the user clear provenance and makes the Review CTA contextual.
**Notes:** Sticky header with global count, collapsible per-source sections, sticky footer with "Review & start extraction" CTA.

---

## Already-in-Basket Indicator Style

| Option | Description | Selected |
|--------|-------------|----------|
| Muted checkbox state with "In basket" label | Consistent with Phase 102's cap-disabled checkbox pattern (LIM-05) | ✓ |
| Overlay badge on paper card | Visual badge positioned over existing paper card component | |
| Icon-only indicator (checkmark) | Minimal visual footprint but less discoverable | |

**User's choice:** [auto] Muted checkbox state — consistent with the cap-disabled checkbox pattern Phase 102 will use for LIM-05, maintaining visual consistency across the selection UX.
**Notes:** Driven by `useExtractionBasketStore(s => s.has(normalizedId))` — O(1) Map lookup, no render storms.

---

## Claude's Discretion

- Internal naming for helper functions within the store
- Exact truncation length for paper titles in the drawer
- Animation spring config for drawer open/close
- Zustand selector pattern vs direct subscription for `has(id)` check
- Test file organization for normalizeOpenAlexId

## Deferred Ideas

None — discussion stayed within phase scope.
