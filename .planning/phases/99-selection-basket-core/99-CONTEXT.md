# Phase 99: Selection Basket Core - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

A tab-scoped, dedupe-safe paper basket that survives in-app navigation and can be peeked from anywhere via a drawer — with zero backend dependency so it can ship in parallel with Phases 100 and 101.

Requirements: SEL-07 (sessionStorage Zustand persistence), SEL-08 (normalizeOpenAlexId dedupe), SEL-09 (Sheet drawer with count + per-source breakdown + CTA), SEL-10 (remove individual papers + "already in basket" indicator).

</domain>

<decisions>
## Implementation Decisions

### Store Architecture
- **D-01:** Create a dedicated basket store in `lib/store/extraction-basket.ts` — NOT inside the existing `lib/store.ts` (42KB monolith). Follow the `createSidebarStore` factory pattern from `lib/store.ts:1070` as a structural template. Use Zustand `persist` middleware with `createJSONStorage(() => sessionStorage)` — the first sessionStorage-backed store in the codebase. Export as `useExtractionBasketStore`.
- **D-02:** The store is cleared only on successful job creation (not on page refresh, not on sign-out). sessionStorage naturally scopes to the browser tab — different tabs get independent baskets.

### Basket Data Shape
- **D-03:** Each basket entry stores rich metadata: `{ openAlexId: string, title: string, doi: string | null, source: BasketSource, addedAt: number }` where `BasketSource = "library" | "collection" | "search" | "manual" | "zotero"`. The `openAlexId` is the normalized canonical form (always `W\d+`). Title and DOI are stored at add-time to avoid re-fetch when displaying the drawer. The `source` field enables the per-source breakdown required by SEL-09.
- **D-04:** The store's internal data structure is a `Map<string, BasketEntry>` keyed by normalized OpenAlex ID. Dedupe is enforced at the Map level — `add` is idempotent (adding an already-present ID is a no-op that preserves the original entry). Expose `count`, `entries`, `entriesBySource`, `has(id)`, `add(entry | entry[])`, `remove(id)`, `clear()`.

### Dedupe & Normalization
- **D-05:** Create a `normalizeOpenAlexId(input: string): string | null` utility in `lib/openalex/normalize.ts`. It handles three formats: bare `W123`, full URL `https://openalex.org/W123`, and prefixed `openalex:W123`. Returns the canonical `W\d+` form or `null` for unparseable input. All basket add-paths MUST normalize before inserting.

### Drawer Content Layout
- **D-06:** The basket drawer uses shadcn `Sheet` (side="right") from `components/ui/sheet.tsx`. Layout: sticky header with global count ("X papers"), collapsible per-source sections (Library, Search, Manual, etc.) each showing section count and paper list, and a sticky footer with "Review & start extraction" CTA button that navigates to `/extraction/new`.
- **D-07:** Each paper row in the drawer shows title (truncated), DOI (if available), source badge, and a remove button (X icon). No inline editing, no reordering.

### "Already in Basket" Indicator
- **D-08:** Papers already in the basket show a muted/checked checkbox state with an "In basket" label in any source list. This reuses the same visual pattern that Phase 102 will use for cap-disabled checkboxes (LIM-05), maintaining consistency. The indicator is driven by `useExtractionBasketStore(s => s.has(normalizedId))`.

### Hook API
- **D-09:** Create a `useAddToBasket` hook in `lib/hooks/use-add-to-basket.ts` that wraps `normalizeOpenAlexId` + `useExtractionBasketStore.add()` with validation and returns `{ addToBasket, removeFromBasket, isInBasket, basketCount }`. This is the public API consumed by Phase 102's `<AddToExtractionButton>` and Phase 103's selector tabs.

### Claude's Discretion
- Internal naming for helper functions within the store
- Exact truncation length for paper titles in the drawer
- Animation spring config for drawer open/close (use existing `lib/animation-config.ts` presets)
- Whether to use a Zustand selector pattern or direct subscription for the `has(id)` check
- Test file organization for the normalizeOpenAlexId utility

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Zustand Store Patterns
- `lib/store.ts` — All existing Zustand stores; `createSidebarStore` factory at line 1070; persist middleware + `createJSONStorage` pattern
- `lib/store.ts:1070-1110` — `createSidebarStore` factory: the structural template for the basket store factory

### UI Components
- `components/ui/sheet.tsx` — Full shadcn Sheet component (Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription)
- `components/app-sidebar.tsx` — NavItem with `badge?: number` prop (Phase 102 will consume this for sidebar badge)

### Selection Primitives
- `lib/hooks/use-selection.ts` — Existing `useSelection` hook (in-memory Set-based); reference for API shape but NOT the persistence mechanism

### OpenAlex
- `lib/openalex.ts` — OpenAlex SDK client singleton; `normalizeOpenAlexId` will be created alongside this

### Extraction System
- `convex/lib/queryBounds.ts` — `MAX_EXTRACTION_PAPERS_PER_JOB` (1000) and `EXTRACTION_LIMITS_BY_TIER` from Phase 98
- `convex/extraction/mutations.ts` — `createExtractionJob` mutation (basket clears on successful job creation)

### Phase 98 Context
- `.planning/phases/98-pre-flight-hard-limit-foundation/98-CONTEXT.md` — Prior decisions on limit constants and per-tier shape

### Convex Guidelines
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions (MUST read before writing any Convex code)

### Conventions
- `.planning/codebase/CONVENTIONS.md` — File naming (kebab-case), store naming (`useXxxStore`), constant naming (`SCREAMING_SNAKE_CASE`)
- `.planning/codebase/STRUCTURE.md` — Where to add new code: hooks in `lib/hooks/`, stores in `lib/store/`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/ui/sheet.tsx` — Full shadcn Sheet ready for the drawer; supports `side="right"` variant
- `lib/hooks/use-selection.ts` — `useSelection` hook with `toggleSelect`, `clearSelection` API shape; reference only (no persistence)
- `lib/animation-config.ts` — Motion spring presets (`subtleSpring`, `cardEntrance`, `commandCenterSpring`) for drawer animation
- `lib/store.ts:1070` — `createSidebarStore` factory: persist middleware boilerplate, hydration tracking (`_hasHydrated`), version migration pattern

### Established Patterns
- Zustand stores: `create<T>()(persist((set, get) => ({ ... }), { name, version, migrate, storage: createJSONStorage(...), partialize, onRehydrateStorage }))` — switch `localStorage` to `sessionStorage` for basket
- Store naming: `useXxxStore` convention (e.g., `useSearchHistoryStore`, `useUIStore`)
- Hook naming: `use-xxx.ts` files in `lib/hooks/`
- Component files: `kebab-case.tsx`
- Constants: `SCREAMING_SNAKE_CASE` with `as const`

### Integration Points
- `components/app-sidebar.tsx` — `NavItem` already accepts `badge?: number` prop; Phase 102 passes `badge={basketCount}`
- `app/extraction/new/` — The `/extraction/new` page (Phase 103) will host the selector tabs that feed into this basket
- `convex/extraction/mutations.ts` — `createExtractionJob` success triggers basket clear
- Every source tab (library, search, bookmarks, collections) will need to import `useAddToBasket` hook

</code_context>

<specifics>
## Specific Ideas

- The basket store is the ONLY net-new Zustand store for this phase. It must be self-contained with zero backend dependency — no Convex queries, no API calls. Pure client-side state.
- `normalizeOpenAlexId` must handle edge cases: leading/trailing whitespace, case-insensitive matching, URLs with query params (`https://openalex.org/W123?foo=bar`), and the `openalex:` prefix. Return `null` for non-OpenAlex IDs (DOIs, PMIDs, etc.).
- The drawer's "Review & start extraction" CTA navigates to `/extraction/new` — it does NOT create a job directly. Job creation happens in Phase 103 after the user selects questions and tier.
- sessionStorage serialization: Zustand's `createJSONStorage(() => sessionStorage)` handles Map serialization via `partialize` — convert Map to array of entries for storage, reconstruct on rehydrate.
- The `has(id)` check must be O(1) — driven by the Map key lookup — so the "already in basket" indicator doesn't cause render storms in lists of 100+ papers.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 99-selection-basket-core*
*Context gathered: 2026-04-15*
