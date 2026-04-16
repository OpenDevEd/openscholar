# Phase 102: Entry Points & Counter UX - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Surface the extraction basket from every paper-browsing command center in the app (library, search results) with an `<AddToExtractionButton>`, add a sidebar nav badge with live basket count, and build an "X / 1000" counter with progress bar and cap-disabled checkboxes that make the hard limit discoverable long before submit.

Requirements: LIM-04 (always-visible counter with progress bar, yellow at 80%, red at 100%), LIM-05 (cap-disabled checkboxes with tooltip), LIM-06 (bulk-paste excess drop toast with exact counts), SEL-11 (AddToExtractionButton in library and search), SEL-12 (sidebar nav badge with live basket count).

</domain>

<decisions>
## Implementation Decisions

### Counter & Progress Bar Component
- **D-01:** Create a shared `<ExtractionCounter>` component in `components/extraction/extraction-counter.tsx` that renders the "X / 1000 papers" label with a progress bar. The component consumes `useExtractionBasketStore(s => s.papers.size)` for the current count and the `getExtractionLimit` reactive query (from Phase 98, `convex/extraction/queries.ts:689`) for the user's per-tier limit. The progress bar uses the existing shadcn `<Progress>` primitive from `components/ui/progress.tsx`.
- **D-02:** The progress bar color transitions: default primary under 80%, yellow/warning at 80-99%, red/destructive at 100%. These thresholds are computed from `count / limit` — NOT hardcoded against 1000. This ensures correct behavior when per-tier limits diverge in v7.1.
- **D-03:** `<ExtractionCounter>` is mounted in two locations: (1) the basket drawer header (replacing the current plain count in `components/extraction/extraction-basket-drawer.tsx`), and (2) the `/extraction/new` selector page (Phase 103 will consume this component directly). The component is self-contained — it reads its own data, no props required for the default usage.

### AddToExtractionButton Component
- **D-04:** Create an `<AddToExtractionButton>` component in `components/extraction/add-to-extraction-button.tsx`. It is a standalone icon button (not inside a dropdown menu) for high discoverability. The button uses the `useAddToBasket` hook from `lib/hooks/use-add-to-basket.ts` (Phase 99 output). Visual states: default (plus icon), already-in-basket (check icon with muted style, matching Phase 99's "already in basket" pattern), disabled-at-cap (muted with tooltip from LIM-05).
- **D-05:** The button accepts props: `{ paper: { rawId: string; title: string; doi: string | null }; source: BasketSource }`. It normalizes the ID internally via `useAddToBasket.addToBasket()` and toggles between add/remove. The `source` prop is required so the basket's per-source breakdown (SEL-09) stays accurate.
- **D-06:** The button renders a tooltip on hover: "Add to extraction basket" (default), "Already in basket" (when present), or "Basket full — remove N papers to continue" (when at cap). All tooltip text is i18n-keyed.

### Mount Points
- **D-07:** Library page: `<AddToExtractionButton>` mounts inside `LibraryItemActions` (`components/library/library-item-shared.tsx:21`) as a standalone icon button alongside the existing external-link and dropdown-menu actions. Source: `"library"`.
- **D-08:** Search results page: `<AddToExtractionButton>` mounts inside the `PaperCard` action area (`components/paper-card/shared.tsx`). Each card variant (`PaperCardListDetail`, `PaperCardListSimple`, `PaperCardGrid`) gets the button in its action toolbar. Source: `"search"`.
- **D-09:** Bookmarks are keyword bookmarks (not individual papers) — they do not have per-paper action slots. SEL-11's reference to "bookmarks command centers" is satisfied by library and search, which are the actual paper-browsing surfaces. No `AddToExtractionButton` mount in the bookmarks page.

### Sidebar Nav Badge
- **D-10:** The Extraction `NavItem` in `components/app-sidebar.tsx` (line 627) receives `badge={basketCount}` where `basketCount` is derived from `useExtractionBasketStore(s => s.papers.size)`. The badge renders using the existing badge infrastructure (collapsed overlay pill, expanded inline badge, tooltip badge) — no new badge component needed.
- **D-11:** The badge shows `0` as no badge (hidden), `1-9` as the number, and `9+` for counts above 9 (matching the existing collapsed badge overflow pattern at line 140-148). When the basket is empty, no badge appears.

### Cap-Disabled Checkboxes
- **D-12:** When the basket count equals the user's extraction limit (from `getExtractionLimit` query), all "add" buttons across all mount points (library, search, selector tabs) disable with a muted visual state. The tooltip changes to "Basket full — remove {excess} papers to continue" where `excess = 0` (at exact cap) simplifies to "Basket full — remove papers to continue".
- **D-13:** The cap-disabled state is driven by a shared `useIsBasketFull` hook (or inline selector) that compares `papers.size >= limit`. This single comparison point prevents desync between mount points.

### Bulk-Paste Drop Toast
- **D-14:** When `useAddToBasket.addToBasket()` receives a batch of entries that would exceed the cap, it adds entries up to the remaining capacity and returns a result object `{ added: number; dropped: number }`. The caller renders an informational toast: "Added {added} papers; {dropped} dropped — basket limit reached" using the existing toast system.
- **D-15:** The drop behavior is "first N fit" — entries are added in the order they appear in the input array until the basket is full. No prioritization or sorting. The toast uses `"info"` variant (not error) — truncation is expected behavior, not a failure.

### i18n Keys
- **D-16:** Seed i18n keys in all 6 locale files under the `extraction.counter` and `extraction.addButton` namespaces before any UI work. Keys needed:
  - `extraction.counter.label` — "{count} / {limit} papers"
  - `extraction.counter.limitReached` — "Basket limit reached"
  - `extraction.counter.limitWarning` — "Approaching basket limit"
  - `extraction.addButton.add` — "Add to extraction basket"
  - `extraction.addButton.remove` — "Remove from basket"
  - `extraction.addButton.inBasket` — "Already in basket"
  - `extraction.addButton.basketFull` — "Basket full — remove papers to continue"
  - `extraction.addButton.dropped` — "Added {added} papers; {dropped} dropped — basket limit reached"

### Claude's Discretion
- Exact Tailwind color classes for the yellow/red progress bar thresholds
- Whether to use `cn()` class merging or separate CSS classes for progress bar states
- Animation on badge count changes (pulse, scale, or none — use existing `lib/animation-config.ts` presets if animating)
- Test file organization (colocated vs `__tests__/` directory)
- Whether `useIsBasketFull` is a standalone hook or an inline selector pattern
- Exact icon choice for the AddToExtractionButton (Plus/Check from lucide-react)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Basket Store & Hook (Phase 99 output)
- `lib/store/extraction-basket.ts` — `useExtractionBasketStore`, `BasketEntry`, `BasketSource` types, `papers` Map, `add()`, `remove()`, `has()`, `clear()` methods
- `lib/hooks/use-add-to-basket.ts` — `useAddToBasket` hook with `addToBasket`, `removeFromBasket`, `isInBasket`, `basketCount` API; comment at line 22 names Phase 102 as primary consumer

### Basket Drawer (Phase 99 output)
- `components/extraction/extraction-basket-drawer.tsx` — Current drawer component using Sheet right-side; header shows plain count; Phase 102 replaces with `<ExtractionCounter>`

### Limit System (Phase 98 output)
- `convex/lib/queryBounds.ts` — `EXTRACTION_LIMITS_BY_TIER` (line 24), `MAX_EXTRACTION_PAPERS_PER_JOB` (line 34)
- `convex/lib/extractionLimit.ts` — `getExtractionLimitForUser(ctx, userId)` helper (line 18)
- `convex/extraction/queries.ts:689-710` — `getExtractionLimit` reactive query returning `{ limit, plan }`; comment at line 687 says "Phase 102 consumes this"

### Sidebar Nav
- `components/app-sidebar.tsx` — `NavItem` with `badge?: number` prop (line 75); badge rendering at lines 140-148 (collapsed), 165-185 (expanded), 227-233 (tooltip); Extraction nav item at line 627 (no badge currently)

### Library Page Mount Point
- `components/library/library-item-shared.tsx:21` — `LibraryItemActions` component with external-link and dropdown; AddToExtractionButton mounts here
- `components/library/library-page-client.tsx:530-559` — Paper listing via `pageResults.map()` rendering `<PaperCard>` + `<LibraryItemActions>`

### Search Results Mount Point
- `components/paper-card/shared.tsx:27` — `PaperCard` props interface; action buttons per card variant
- `components/results-list.tsx:75` — `PapersGrid`/`PapersList` rendering papers via `<PaperCard>`
- `components/paper-card/index.tsx` — Card variant dispatch (ListDetail, ListSimple, Grid)

### UI Primitives
- `components/ui/progress.tsx` — shadcn Progress primitive (radix-ui based), `value` prop, `h-2 rounded-full` default
- `components/ui/tooltip.tsx` — shadcn Tooltip primitive for button tooltips
- `components/ui/badge.tsx` — shadcn Badge (reference only — sidebar badge is custom)

### Error System (Phase 100 output)
- `lib/toast/error-resolver.ts:105` — `EXTRACTION_LIMIT_EXCEEDED` mapped to `extractionLimitExceeded` i18n key

### i18n
- `messages/en-US.json` — `extraction.basket.*` namespace already seeded (line ~1559); `extraction.counter.*` and `extraction.addButton.*` namespaces to be added

### Normalize Utility (Phase 99 output)
- `lib/openalex/normalize.ts` — `normalizeOpenAlexId(input): string | null`

### Conventions
- `.planning/codebase/CONVENTIONS.md` — File naming (kebab-case), component naming (PascalCase), i18n key naming
- `.planning/codebase/STRUCTURE.md` — Directory layout for new files

### Convex Guidelines
- `convex/_generated/ai/guidelines.md` — Convex API patterns (MUST read before writing any Convex code)

### Prior Phase Context
- `.planning/phases/98-pre-flight-hard-limit-foundation/98-CONTEXT.md` — Limit constant architecture
- `.planning/phases/99-selection-basket-core/99-CONTEXT.md` — Basket store and hook decisions
- `.planning/phases/100-backend-wiring-tierselector-fix/100-CONTEXT.md` — Error system and TierSelector decisions
- `.planning/phases/101-workbench-primitives/101-CONTEXT.md` — Workbench store and toolbar patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/ui/progress.tsx` — shadcn Progress primitive ready for the counter progress bar
- `components/ui/tooltip.tsx` — shadcn Tooltip for button hover states
- `lib/hooks/use-add-to-basket.ts` — Complete hook API; Phase 102 wraps it inside `<AddToExtractionButton>`
- `lib/store/extraction-basket.ts` — Basket store with `papers.size` for count, `has(id)` for O(1) membership check
- `components/app-sidebar.tsx` — NavItem already renders badges in 3 locations (collapsed/expanded/tooltip)
- `lib/animation-config.ts` — Motion spring presets for any badge/counter animations
- `lib/toast/error-resolver.ts` — `EXTRACTION_LIMIT_EXCEEDED` already mapped; toast infra ready

### Established Patterns
- Zustand selectors: `useExtractionBasketStore(s => s.papers.size)` for reactive count
- i18n: all locale files under `messages/` with `en-US.json` as source of truth
- Icon buttons: lucide-react icons wrapped in shadcn `Button` variant `ghost` size `icon`
- Tooltip pattern: `<TooltipProvider>` → `<Tooltip>` → `<TooltipTrigger>` → `<TooltipContent>`
- shadcn Sheet: `side="right"` pattern used by basket drawer

### Integration Points
- `components/extraction/extraction-basket-drawer.tsx` header — replace plain count with `<ExtractionCounter>`
- `components/library/library-item-shared.tsx` — add `<AddToExtractionButton>` to `LibraryItemActions`
- `components/paper-card/shared.tsx` — add `<AddToExtractionButton>` to PaperCard action areas
- `components/app-sidebar.tsx:627` — add `badge={basketCount}` to Extraction NavItem
- Phase 103 `/extraction/new` page — will consume `<ExtractionCounter>` and `<AddToExtractionButton>` directly

</code_context>

<specifics>
## Specific Ideas

- The `getExtractionLimit` reactive query (Phase 98) returns `{ limit, plan }` — the counter should use `limit` (not hardcoded 1000) for the denominator. This ensures correctness when per-tier limits diverge in v7.1.
- The basket store's `add()` method currently accepts entries without a cap check. Phase 102 must add cap enforcement at the `useAddToBasket` hook level (or a wrapper) that truncates batch additions and returns `{ added, dropped }` counts for the LIM-06 toast.
- The sidebar badge pattern already handles `9+` overflow for collapsed mode — no new badge component needed.
- Bookmarks page manages keyword bookmarks, not individual papers. SEL-11's "bookmarks command centers" requirement is satisfied by library and search mount points.
- i18n keys MUST be seeded in all 6 locale files before any UI component work begins — this is the established v5.0+ pattern.
- The progress bar color transitions (default → yellow → red) should use Tailwind's `data-[state=*]` attributes or conditional className merging, not inline styles.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 102-entry-points-counter-ux*
*Context gathered: 2026-04-16*
