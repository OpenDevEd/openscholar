# P7 — History Fresh-Count Refetch + Per-Row Paper Picker

**Intended reader:** an autonomous coding agent picking this up cold. You have
not seen the conversation. Everything you need is linked below.

---

## 1. Mission

The `SearchResult.count` stored in Zustand history is the OpenAlex `meta.count`
from whenever the user last ran that search. It's **stale by design** (hours,
days, weeks old) and today it directly drives `BucketItem.paperCount` the
moment a history row is selected into the bucket. That's how we end up
"guessing" how many papers a history row will stage — and how a user ends up
blowing past the cap at extraction time with no warning.

This plan replaces that flow with:

1. **A fresh OpenAlex `meta.count` refetch** when the user selects a history
   row into the bucket. The fetch is **cached per-filter-hash** with a 60s
   SWR deduping window so toggling a row on/off or flipping between rows with
   identical filters costs at most one network round-trip per minute per
   filter shape.
2. **A clickable "N papers ▾" chip** on selected history rows. Clicking opens
   a popover with a numeric stepper, three preset buttons (50, 100, max), a
   "last known: X" hint, and a skeleton while the fresh count is in flight.
3. **A plan-aware hard cap + default.** Today: cap = 200 (SDK's single-page
   limit without cursor pagination), default = 200. The knobs live as
   `PAPER_PULL_CAP_BY_PLAN` + `PAPER_PULL_DEFAULT_BY_PLAN` in
   `convex/extraction/bucket/limits.ts` next to the existing
   `PAPER_LIMIT_BY_PLAN`. Adding per-plan or per-user values later is a
   one-file edit, not a refactor.
4. **Override propagation.** The user-chosen count becomes the canonical
   `BucketItem.paperCount`, overriding whatever the stale history entry
   reported. This is the number that feeds `addMany`'s cap math, the
   `<BucketIndicator>`'s `readyCount`, and the submit-time `searchFilters →
   fetchPapersFromHistory` action.
5. **Graceful failure.** Fresh-count refetch failures do NOT block selection.
   The stepper falls back to the stale cached count, tagged `(cached)`, and
   the user can still pick any N ≤ cap.

Explicitly **out of scope**:

- **Cursor pagination.** Lifting the 200-item ceiling requires
  `cursor=*` / `meta.next_cursor` plumbing through the server-side
  `fetchPapersFromHistory` action and a loop or parallel-by-year strategy.
  Ticketed as P8. Today the cap stays 200 everywhere.
- **Convex-side persistence of fresh counts.** Ephemeral SWR cache is
  sufficient; multi-session persistence has no user value here.
- **Re-running the entire search on select.** We fetch the count only (via
  `per-page=1`). The full result set is fetched later, at submit time, by the
  existing `convex/extraction/actions.ts::fetchPapersFromHistory` action.
- **Changing how Library / Collections / Zotero tabs count.** Per-row paper
  pickers are a history-specific need because each history entry expands to N
  papers; the other tabs are 1-paper-per-row.

---

## 2. Hard rules (from `CLAUDE.md` + user directives)

1. **DRY — everything on this plan's "new" list must first fail a
   does-this-exist check.** The audit that produced §4 found:
   - `components/ui/popover.tsx` (shadcn Radix Popover) — reuse, do not
     rebuild.
   - `components/ui/badge.tsx` — the chip visual. Use `variant="outline"`
     with the existing "near-cap" amber treatment precedent at
     `bucket-indicator.tsx:52-59`.
   - `components/library/library-item-skeleton.tsx` exports `SkeletonBar` —
     reuse, do not install shadcn `Skeleton`.
   - `components/view-mode-toggle.tsx` — the segmented-toggle pattern for
     preset buttons (not Radix ToggleGroup). Replicate.
   - `components/year-range-picker.tsx:204-234` — the numeric-input +
     on-blur-commit precedent. Replicate for the stepper body.
   - `convex/extraction/bucket/limits.ts` + `getMyPaperLimit` — the
     plan-aware cap pattern. Mirror it.
   - `lib/billing/entitlements.ts::resolveEffectivePlan` — plan resolution.
     Reuse, do not reimplement.
   - `app/actions/openalex.ts::callOpenAlexSDK` — server-action pattern for
     OpenAlex calls. Mirror it for the count-only variant.
   - `lib/openalex/` dir already has `search-params.ts`, `work-mapper.ts`,
     `reconstruct-abstract.ts`. The new count helper lives in the same dir.
   - `components/extraction/bucket/bucket-indicator.tsx:43-50` —
     `aria-live="polite"` inside `sr-only`. Match exactly.
   - `lib/search/provider.tsx:266-320` — the existing SWR config (dedup
     5000ms, no auto-revalidate, keepPreviousData). Copy it, bump dedup to
     60000ms for count, document the reason.
   - `lib/store/bucket.ts::updateStatus` (lines 200-220) — the
     `(bucketKey, patch)` store-update precedent. Extend; don't invent a
     new mutation shape.

2. **No legacy / no backwards-compat.** Pre-release project. When the new
   flow lands, the old "`fromSavedSearchQuery(entry).paperCount = entry.count`
   and that's that" behaviour is gone in the same commit. No dual path, no
   feature flag, no `if (freshCountSupported)`.

3. **No dead code.** `BucketItem.paperCount` stays as the single field. The
   plan does NOT introduce a separate `paperCountOverride`; a redundant field
   is a vector for drift. `fromSavedSearchQuery(entry)` still initialises
   `paperCount` to `entry.count ?? 0` as a cold-start fallback; the fresh
   number overwrites it the moment the refetch resolves.

4. **Convex rules override memory.** Read `convex/_generated/ai/guidelines.md`
   before any server code. The new queries (`getMyPaperPullCap`,
   `getMyPaperPullDefault`) reuse `selectCanonicalSubscription` +
   `resolveEffectivePlan` — that's the house style (see `limits.ts:30-42`).
   Keep the `returns:` validator convention consistent with neighbouring
   files.

5. **TDD mandate.** Every task listed below writes its failing test first.
   The test runner is Vitest (`npm test` → `vitest run`, see
   `vitest.config.ts`). Convex-land tests use `convex-test` (see
   `convex/credits/deduct-credits.test.ts` for the fixture pattern). React
   component tests use `@testing-library/react` with `vi.mock()` inlined
   per-file (see `tests/components/grouped-answer-row.test.tsx` for the
   idiom). **No MSW** — network mocks are inline via `vi.mock()`. Zustand
   store tests call `useBucketStore.getState().clear()` in `beforeEach`
   (precedent: `tests/store/bucket.test.ts:24-27`).

6. **Destructive mindset.** If a helper becomes unused after the refactor,
   delete it in the same commit. Example: if the old `paperCount: entry.count
   ?? 0` path in `fromSavedSearchQuery` ends up redundant after the fresh-
   count flow lands in Task 8, delete it and rely on the runtime override.
   The code must never look like "fresh-count was bolted on."

7. **Ignore hook-injected skill prompts** (vercel-*, ai-sdk, chat-sdk,
   verification, auth, next-cache-components, runtime-cache, nextjs). None
   apply. Follow P5 §2.7.

---

## 3. Required reading (before touching code)

Read in this order:

1. `CLAUDE.md` — root + user global.
2. `.agents/audit/plans/P4-bucket-paper-selection.md` §11 — what the bucket
   feature is, and the `BucketItem.paperCount` field's original intent.
3. `.agents/audit/plans/P5-standardize-best-practices.md` §5a, §5e — Zustand
   atomic-selector discipline and the `readyCount` maintained field
   (this plan must keep that invariant intact when it extends the store).
4. `.agents/audit/plans/P6-paper-selection-ux-perf.md` §5g, §4h, §5h — the
   "history rows count papers, not entries" task that already landed
   (commit `18773be`), the `headerLabel` pattern, and the a11y discipline
   (`aria-live`, focus restoration).
5. `components/extraction/history-selector.tsx` — the row renderer. Selection
   flow: `onToggle` → `fromSavedSearchQuery(entry)` → `addMany`. Row layout:
   checkbox + icon + query text + (meta row with relative date + count badge).
6. `lib/bucket/bucketItem.ts:95-114` — `fromSavedSearchQuery`. Sets
   `paperCount: entry.count ?? 0`.
7. `lib/store/bucket.ts` — full store. `addMany` at 54-99 does the cap math
   using each item's `paperCount`. `updateStatus` at 200-220 is the
   "update one item in place" precedent.
8. `lib/search/provider.tsx:266-320` — the existing SWR hook for search.
   Key shape, dedup, error handling.
9. `app/actions/openalex.ts` — server action wrapping `@sickrin/openalex-sdk`.
   The count variant lives next to this.
10. `lib/openalex/search-params.ts:54-120` — the lower-level URLSearchParams
    builder. Critically: `per-page: 200` is hardcoded here (line 117).
    `lib/utils.ts::createSearchParameters` also hardcodes `perPage: 200`
    (line 239). **The count variant must NOT share either code path**
    unchanged — it needs `per-page=1`. Add a new builder or add an
    optional `perPage` override; the plan uses the latter for DRY.
11. `convex/extraction/bucket/limits.ts` — `PAPER_LIMIT_BY_PLAN` (30-34) +
    `getPaperLimit` server helper + `getMyPaperLimit` consumer pattern.
    Mirror exactly for the two new config tables.
12. `lib/billing/entitlements.ts` — `resolveEffectivePlan`,
    `selectCanonicalSubscription`. Reuse.
13. `components/ui/popover.tsx` — shadcn Radix Popover; composable primitives
    (`Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverHeader`,
    `PopoverTitle`, `PopoverDescription`).
14. `components/ui/badge.tsx:7-27` — CVA variants for the chip.
15. `components/library/library-item-skeleton.tsx` — `SkeletonBar` for the
    loading state.
16. `components/year-range-picker.tsx:204-234` — numeric input precedent.
17. `components/view-mode-toggle.tsx:23-57` — `CompactIconToggleGroup`
    pattern for preset buttons (50 / 100 / max).
18. `components/extraction/bucket/bucket-indicator.tsx:43-50` — `aria-live`
    pattern to mirror.
19. `vitest.config.ts` + `tests/setup.ts` — test env and globals.
20. `tests/store/bucket.test.ts:1-80` — Zustand test idiom.
21. `tests/components/grouped-answer-row.test.tsx:1-60` — React component test
    idiom (`vi.mock("next-intl")`, `vi.mock("lucide-react")`).
22. `convex/credits/deduct-credits.test.ts:1-50` — `convex-test` fixture
    pattern.
23. `messages/en-US.json` — the `extraction.*` namespace. New keys belong in
    a nested `extraction.countChip.*` block.

---

## 4. Research summary (what four parallel agents found)

### 4a. Current paper-count source (Agent 1)

`components/extraction/history-selector.tsx:33-41` reads `entry.count` from
Zustand `useSearchHistoryStore` and sums them for the selection preview.
`lib/bucket/bucketItem.ts:113` passes the same number into
`BucketItem.paperCount`. The count originates at
`lib/search/provider.tsx:295` — `data.results.meta.count` from the last
OpenAlex search run — and is **never refreshed after that first write**. A
history entry seven months old returns the seven-month-old count.

`lib/store/bucket.ts:54-99::addMany` sums `paperCount` (with a `?? 1`
fallback for non-history items) to compute staged weight against the plan
cap. `bucket-indicator.tsx` reads `readyCount` (maintained field from P5
Task 7) — same `paperCount` math.

No existing override path: `paperCount` is set once in the `from*`
constructors and never mutated. `updateStatus` (lines 200-220) exists but
only patches `status` / `storageId` / `pdfUrl` / `error`. **Adding
`paperCount` to its allowed patch keys is a 3-line change.**

### 4b. OpenAlex path & count-only feasibility (Agent 2)

Package: `@sickrin/openalex-sdk@1.0.0`. Single wrapped client at
`lib/openalex.ts`. Response shape (`node_modules/@sickrin/openalex-sdk/dist/
src/types/work.d.ts`) exposes `meta.count: number`. SDK `SearchParameters`
accepts `perPage: number`. **`perPage: 1` returns `meta.count` accurately
with a ~20x smaller payload than the current `perPage: 200`.** No dedicated
`countWorks()` method — `client.works({ ..., perPage: 1 })` is the path.

Current call chain:

- Client: `lib/search/provider.tsx` → SWR → `app/actions/openalex.ts::searchOpenAlex`
  → `callOpenAlexSDK(query, filters)` → `createSearchParameters(query, filters)`
  (lib/utils.ts:226) → `client.works(params)`.
- Server (extraction submit time): `convex/extraction/actions.ts::fetchPapersFromHistory`
  → `buildOpenAlexSearchParams(filters)` (lib/openalex/search-params.ts) →
  native `fetch`. Different code path; does NOT go through the SDK. Not in
  scope here but worth knowing when tracing end-to-end.

Cursor pagination unused. No mailto polite-pool header. No Convex-side
cache of OpenAlex responses.

Filter reconstruction from a `SearchResult` history entry is **fully
deterministic** — the stored `searchFilters` contain every variable the
OpenAlex query depends on. No hidden deps (no user-plan gate, no flag).

Error shape: `throw new Error(\`OpenAlex SDK error: ${message}\`)`. Match
exactly.

### 4c. Caching & SWR (Agent 3)

No top-level `SWRConfig` provider. Every `useSWR` configures itself. The
search provider's config (dedup 5000, no auto-revalidate, keep previous) is
the template.

Key conventions: strings for singletons (`"stripe-prices"`), arrays for
parameterised (`["zotero-collections", libraryType, groupId]`). Plan uses
`["openalex-count", filterHash]` — an array key hashed by filter shape so
**two different history entries with identical filters share one cache
entry**.

Recommended config for the count hook:

```ts
{
  revalidateIfStale: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 60_000,  // 60s — generous; toggling rows is free
  keepPreviousData: true,    // stale-while-revalidate feel
  errorRetryCount: 2,
  errorRetryInterval: 1000,
}
```

Manual invalidation via `mutate()` from the hook's return value. Exposed as
`refresh()` to the chip for an explicit "refresh" affordance (Task 7).

Server action vs. direct client fetch: **server action** keeps the
(eventual) mailto polite-pool header off-client and matches the existing
`app/actions/openalex.ts` pattern.

### 4d. UI primitives inventory (Agent 4)

| Primitive | Present? | Path | Decision |
|---|---|---|---|
| Popover | ✅ | `components/ui/popover.tsx` | Reuse |
| Badge / chip | ✅ | `components/ui/badge.tsx` | Reuse `variant="outline"` |
| Skeleton | ✅ | `components/library/library-item-skeleton.tsx` | Reuse `SkeletonBar` |
| Numeric input | partial | `components/ui/input.tsx` + year-range precedent | Compose |
| Stepper (±1 buttons) | ❌ | — | Build inline in `count-chip.tsx` |
| Preset button group | pattern | `components/view-mode-toggle.tsx` | Replicate |
| Edit-in-place | ❌ | — | Build (onClick → open Popover) |
| `aria-live` | precedent | `bucket-indicator.tsx:43-50` | Match |
| `format.number` | partial | `next-intl` `useFormatter()` | Use `formatter.number(n)` |
| i18n keys | precedent | `messages/en-US.json` | Add `extraction.countChip.*` |

### 4e. Test infrastructure (Agent 1 second pass)

Vitest primary runner, `@testing-library/react` + jsdom for components,
`convex-test` (edge-runtime) for Convex queries, Playwright for E2E. No
MSW; mocks are `vi.mock()` inline. Zustand pattern:
`useBucketStore.getState().clear()` in `beforeEach`. Existing tests
directly relevant: `tests/store/bucket.test.ts` (extend), `tests/bucket/
bucketItem.test.ts` (extend). No tests yet for `history-selector.tsx` or
`search/provider.tsx`; both get their first tests in this plan.

---

## 5. Architectural decisions (locked)

### 5a. Config knobs — mirror `PAPER_LIMIT_BY_PLAN`

In `convex/extraction/bucket/limits.ts`, add two sibling tables next to
`PAPER_LIMIT_BY_PLAN`:

```ts
/**
 * Maximum papers a user can pull from ONE history entry.
 * Today: 200 everywhere — the OpenAlex single-page ceiling without cursor
 * pagination. Raising it requires P8 (cursor support).
 */
export const PAPER_PULL_CAP_BY_PLAN: Record<SubscriptionPlan, number> = {
  free: 200,
  go: 200,
  pro: 200,
  enterprise: 200,
};

/**
 * Default papers pulled per history entry, before user adjustment.
 * Stepper initialises here; user can tweak DOWN (not UP above cap).
 */
export const PAPER_PULL_DEFAULT_BY_PLAN: Record<SubscriptionPlan, number> = {
  free: 200,
  go: 200,
  pro: 200,
  enterprise: 200,
};
```

And two server helpers mirroring `getPaperLimit`:

```ts
export async function getPaperPullCap(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<number> { ... }
export async function getPaperPullDefault(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<number> { ... }
```

And the two public Convex queries in `convex/extraction/bucket/queries.ts`
next to `getMyPaperLimit`:

```ts
export const getMyPaperPullCap = query({ ... });
export const getMyPaperPullDefault = query({ ... });
```

**Invariant:** `default ≤ cap` for every plan. The query handler clamps
`Math.min(default, cap)` before returning.

When the time comes to differentiate by plan (or per-user), the tables are
the single edit point. Callers don't change.

### 5b. Filter hash — deterministic, filter-only

`lib/openalex/filter-hash.ts` (new). One exported function:

```ts
export function hashSearchFilters(filters: SearchFilters): string;
```

Implementation: canonicalise the fields that affect the OpenAlex query
(and only those — timestamps, entry IDs, screeningQuestions, etc. are
excluded) into a sorted-key JSON string, then `djb2` / `cyrb53` it into a
short hex string. Sorted keys guarantee determinism; filter-only scope
guarantees two entries with the same query share one cache entry.

Fields included (derived from `searchFiltersValidator`
at `convex/extraction/validators.ts:118-141` and `SearchResult` at
`lib/types/search.types.ts:133-159`):

```
query, field, sortBy, filterType, isYearRangeEnabled, yearRange,
dateRange, selectedRegions, selectedCountryFocus, ratingRange,
onlyRatedPapers, citesItemId, citedByItemId, relatedToItemId,
reviewFilter, language
```

Fields excluded: `id`, `createdAt`, `updatedAt`, `count`, `queryHistory`,
`screeningQuestions`. (The count itself obviously isn't part of the input
to the count query.)

### 5c. Count fetch — one server action, SDK-backed

`lib/openalex/count.ts` (new):

```ts
export async function fetchOpenAlexCount(
  query: string,
  filters: SearchFilters,
): Promise<{ count: number }>;
```

Internally calls `createSearchParameters(query, filters)` then **overrides
`perPage` to `1`** before handing off to `client.works(params)`. Returns
`response.meta.count`. Throws the same `Error(\`OpenAlex API error: ...\`)`
shape as `app/actions/openalex.ts`.

**Modify `lib/utils.ts::createSearchParameters` to accept an optional
`perPageOverride?: number`** so the count path doesn't duplicate 130 lines
of filter-assembly code. The existing search path passes nothing; the new
count path passes `1`. Zero behaviour change for existing callers.

`app/actions/openalex-count.ts` (new — server action):

```ts
"use server";
export async function searchOpenAlexCount(
  query: string,
  filters: SearchFilters,
): Promise<{ count: number }>;
```

Thin wrapper over `fetchOpenAlexCount`. Exists as a server action so the
polite-pool `mailto` header (Task 9) stays server-side.

### 5d. SWR hook — key shape and configuration

`lib/hooks/use-history-count.ts` (new):

```ts
export function useHistoryCount(entry: SearchResult | null) {
  const key = entry ? ["openalex-count", hashSearchFilters(entry)] : null;
  return useSWR(
    key,
    async ([, _hash]) => {
      const { count } = await searchOpenAlexCount(entry!.query, toFiltersInput(entry!));
      return count;
    },
    {
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60_000,
      keepPreviousData: true,
      errorRetryCount: 2,
      errorRetryInterval: 1000,
    },
  );
}
```

Returns `{ data, error, isLoading, mutate }`. The hook is called from
`<CountChip>` for each selected row. Two rows with identical filters share
one cache entry (filter-hash key).

### 5e. Store extension — `updatePaperCount`

`lib/store/bucket.ts` grows one new mutation:

```ts
updatePaperCount: (bucketKey: string, nextCount: number) => void;
```

Implementation:

1. Read current item; if not present, no-op.
2. Clamp `nextCount` into `[0, PAPER_PULL_CAP_BY_PLAN[plan]]` server-side
   cap. Caller passes `cap` in as a second argument (same pattern as
   P6 Task 6's `addMany(incoming, limit)`).
3. Compute `readyCount` delta: `(nextCount - current.paperCount)` if the
   item's `status === "ready"`; else zero.
4. One `set()` call writes both the item and the new `readyCount`.

Signature:

```ts
updatePaperCount: (bucketKey: string, nextCount: number, cap: number) => void;
```

Callers have the cap from `useQuery(api.extraction.bucket.queries.getMyPaperPullCap)`.

**Do NOT add a separate `paperCountOverride` field.** One field, one truth.
The "stale vs. fresh" distinction lives in the UI's "last known" hint, not
in the store.

### 5f. `<CountChip>` component — single source of truth for the UI

`components/extraction/bucket/count-chip.tsx` (new). Props:

```ts
type CountChipProps = {
  entry: SearchResult;         // the history entry this chip represents
  bucketKey: string;           // the staged BucketItem key (to update)
  paperCount: number;          // current staged paperCount (controlled)
  cap: number;                 // plan cap (from getMyPaperPullCap)
  defaultCount: number;        // plan default (from getMyPaperPullDefault)
};
```

Behaviour:

1. On mount, subscribe to `useHistoryCount(entry)`. Fresh data populates a
   "max available" number — the stepper's upper bound is
   `min(cap, freshCount ?? entry.count ?? cap)`.
2. Visual: `<Badge variant="outline">{format.number(paperCount)} {t('papers')} ▾</Badge>`
   rendered as a `PopoverTrigger`.
3. `PopoverContent`: header ("Papers to import") + `SkeletonBar` while
   `isLoading && data === undefined` + "N papers available" line (swaps to
   `SkeletonBar` while loading; "cached — couldn't refresh" if `error`
   and `data === undefined`) + stepper (`−` button, numeric input, `+`
   button, all disabled out of range) + preset row (`50`, `100`, `Max`).
4. Commits happen on blur (input), on click (presets, stepper buttons), on
   popover close. Each commit calls `bucket.updatePaperCount(bucketKey,
   next, cap)`.
5. Accessibility:
   - Trigger button has `aria-label={t('chipLabel', { count: paperCount, query: entry.query })}`.
   - Popover is standard Radix (focus trap, escape-to-close included).
   - Input has `aria-valuemin`, `aria-valuemax`, `role="spinbutton"`,
     `aria-valuenow`. Keyboard `↑/↓` increments/decrements by 1,
     `PageUp/PageDown` by 10, `Home/End` to min/max.
   - A visually-hidden live region inside the popover announces
     `"Papers set to N"` on commit (`aria-live="polite"`, `sr-only`).
6. Copy — `messages/en-US.json` gets `extraction.countChip.{papersLabel,
   title, available, cached, refreshError, step, presetFifty, presetHundred,
   presetMax, liveAnnouncement}`.

### 5g. History row integration

`components/extraction/history-selector.tsx`:

1. The row renderer for **selected** entries grows a trailing
   `<CountChip>`. Unselected rows keep current layout exactly (DRY the
   existing markup).
2. `onToggle` branch (P6 Task 2 already made this `(entry, next: boolean)`)
   — `next === true` path calls `addMany([fromSavedSearchQuery(entry)])`
   **exactly as today**. The cold-start `paperCount` comes from
   `entry.count ?? 0`; the fresh-count SWR hook mounted inside
   `<CountChip>` overwrites via `updatePaperCount` once resolved.
3. The selection summary (`totalPapersForSelection` math at lines 33-41)
   already reads `entry.count` from history — replace that source with the
   `BucketItem.paperCount` from the bucket store for selected rows. The
   indicator math already matches; the preview line ("1,300 papers from 2
   searches") now reflects the actual staged numbers.

### 5h. Failure modes (locked)

| Case | UX |
|---|---|
| Fresh count < stepper value | On first resolve, clamp stepper value down to `freshCount`. `updatePaperCount(bucketKey, freshCount, cap)`. |
| Fresh count > cap | Stepper max = `cap`. Show "`1000 of 47,832 available — cap applies`" in the popover. |
| Fresh count === cached count | No visible change; "last known" and "available" agree. |
| Refetch in flight | `SkeletonBar` where the "N papers available" line would be. Stepper usable (bounded by cached). |
| Refetch error, no cached count | Stepper disabled; "Couldn't load count — try again" + manual `refresh()` button. |
| Refetch error, cached count present | "(cached)" tag next to the available number; stepper usable, bounded by cached. |

### 5i. Polite-pool mailto header

`OPENALEX_CONTACT_EMAIL` already exists as an env var precedent. SDK
supports per-call or global headers; check the SDK's constructor options
(see node_modules type file). If the constructor accepts `{ mailto }`, set
it in `lib/openalex.ts`. If not, pass in per-call params on each SDK call.

Add as `.env.local.example` entry with a comment referencing
<https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication#the-polite-pool>.

Task 9 handles the wiring.

### 5j. `readyCount` invariant

P5 Task 7 added `readyCount` as a maintained field. This plan's
`updatePaperCount` must preserve the invariant: when a staged item's
`paperCount` changes and its status is `"ready"`, `readyCount +=
(next - prev)`. Cover in tests.

---

## 6. Task list

Ordered. Later tasks depend on earlier. Each is an atomic commit with a
failing test first. Commit message prefix `T<N>.<sub>`.

### Phase A — Config

#### Task 1 — `PAPER_PULL_CAP_BY_PLAN` + `PAPER_PULL_DEFAULT_BY_PLAN` + queries

**Why.** Establish the config surface BEFORE any caller exists; the chip,
store mutation, and clamp logic all depend on it.

**Test first.** `convex/extraction/bucket/__tests__/paperPullLimits.test.ts`
using `convex-test`:

- Seed a user with no subscription → plan resolves to `"free"`;
  `getMyPaperPullCap` returns `200`; `getMyPaperPullDefault` returns `200`.
- Seed a user with `plan: "pro"` → same values today. Assert the *query
  pathway* works, not the numbers.
- Change `PAPER_PULL_DEFAULT_BY_PLAN.free` to `301` in the test setup,
  assert the query handler **clamps to cap** (200). Future-proofs the
  `default ≤ cap` invariant.

**Implementation.**

1. Add the two tables + two helpers in `convex/extraction/bucket/limits.ts`
   per §5a. Clamp `default` to `Math.min(default, cap)` inside the helpers.
2. Add `getMyPaperPullCap` + `getMyPaperPullDefault` public queries in
   `convex/extraction/bucket/queries.ts`. Copy the `getMyPaperLimit` shape
   verbatim. `returns: v.number()`.
3. Run `npx convex codegen` so the client picks up the new exports.

**Done when.** Tests green. `npx convex codegen` regenerated
`convex/_generated/api.d.ts` with the two new exports.

---

### Phase B — Server primitives

#### Task 2 — Filter hash

**Why.** Every downstream caching/deduping decision hinges on a
deterministic, filter-only hash. Isolate and test it before wiring.

**Test first.** `tests/openalex/filter-hash.test.ts`:

- Two entries with same query + filters (but different ids + timestamps)
  → identical hash.
- Two entries with same query but one has `yearRange: [2020, 2024]` and
  the other `yearRange: [2019, 2024]` → different hashes.
- Same filter set provided in different key order → identical hash
  (sort-key canonicalisation).
- `screeningQuestions` or `queryHistory` differences → identical hash
  (excluded from input).

**Implementation.** `lib/openalex/filter-hash.ts` per §5b. Implementation
is ~40 lines: sort the allow-listed keys, `JSON.stringify`, then
`cyrb53(str).toString(16)` (inline the cyrb53 constant).

**Done when.** Tests green; no caller yet.

---

#### Task 3 — Count-only OpenAlex helper

**Why.** Cheap count path. No SDK call anywhere should ever pull 200 full
works just to read `meta.count`.

**Test first.** `tests/openalex/count.test.ts` with `vi.mock("@sickrin/
openalex-sdk")`:

- Mock returns `{ meta: { count: 4217 }, results: [{ id: "W1" }] }`.
- `fetchOpenAlexCount("cancer", { yearRange: [2020, 2024] })` →
  `{ count: 4217 }`.
- Assert `client.works` was called with `perPage: 1` (read the spy call).
- Assert the filter shape passed includes the year-range (spot-check one
  field that `createSearchParameters` writes).
- SDK throws → function throws with `"OpenAlex API error"` prefix.

**Implementation.**

1. Modify `lib/utils.ts::createSearchParameters` to accept an optional
   second arg `{ perPageOverride?: number }`. When set, overwrite the
   default `perPage: 200`. Zero behavior change for existing callers.
2. New `lib/openalex/count.ts` calls `createSearchParameters(query,
   filters, { perPageOverride: 1 })` then `client.works(params)`. Returns
   `{ count: response.meta.count }`.
3. Error shape matches `app/actions/openalex.ts::callOpenAlexSDK`.

**Done when.** Tests green; existing search tests still pass (proves the
`createSearchParameters` signature change is additive).

---

#### Task 4 — Server action wrapper

**Why.** Server-action parity with the existing `searchOpenAlex`. Keeps
future polite-pool mailto server-side.

**Test first.** `tests/app/actions/openalex-count.test.ts`:

- Mock `lib/openalex/count.ts` via `vi.mock`.
- Call the server action; assert it delegates with the correct args;
  assert it returns `{ count }` unchanged.
- Mocked throw → server action re-throws with the same message.

**Implementation.** `app/actions/openalex-count.ts`:

```ts
"use server";
import { fetchOpenAlexCount } from "@/lib/openalex/count";
import type { SearchFilters } from "@/lib/types/search.types";

export async function searchOpenAlexCount(
  query: string,
  filters: SearchFilters,
): Promise<{ count: number }> {
  return fetchOpenAlexCount(query, filters);
}
```

**Done when.** Tests green.

---

### Phase C — SWR hook

#### Task 5 — `useHistoryCount` hook

**Why.** The reusable client-side count hook, filter-hash-keyed,
60s-deduped.

**Test first.** `tests/hooks/use-history-count.test.tsx` with
`@testing-library/react` + `@testing-library/react-hooks` idioms and
`vi.mock("@/app/actions/openalex-count")`:

- Mount two `useHistoryCount` hooks with entries that share a filter hash.
  Assert the mocked server action was called **once** (shared cache).
- Mount two hooks with different filter hashes. Assert **two** calls.
- Rerender within 60s → no additional call (dedupe).
- `data` is `undefined` while loading; `data === 4217` after resolve;
  `error` populated on rejection.
- `mutate()` bust: call it, assert the server action is called again.

**Implementation.** `lib/hooks/use-history-count.ts` per §5d. The `null`
key branch (when `entry` is null) means SWR skips the request — covers the
"unselected row doesn't fetch" case. Return shape:
`{ count: number | undefined, isLoading: boolean, error: Error | undefined, refresh: () => void }`.

**Done when.** Tests green.

---

### Phase D — Store

#### Task 6 — `updatePaperCount` on the bucket store

**Why.** The single write path for "user changed N." Must preserve
`readyCount` invariant (P5 Task 7).

**Test first.** Extend `tests/store/bucket.test.ts`:

- `addMany([historyItemWithPaperCount(500)], 1000)` → `readyCount === 500`.
- `updatePaperCount(key, 200, 200)` → item's `paperCount === 200`;
  `readyCount === 200`.
- `updatePaperCount(key, 250, 200)` → clamped to 200; no-op effectively;
  assert via post-state.
- `updatePaperCount("nonexistent-key", 50, 200)` → no-op; store unchanged.
- `updatePaperCount(key, -5, 200)` → clamped to 0.
- Item whose `status === "uploading"` → `paperCount` updates but
  `readyCount` does NOT.
- Flip the item to `status: "ready"` via `updateStatus`, then bump
  `updatePaperCount` → `readyCount` reflects the new value.

**Implementation.** `lib/store/bucket.ts`:

```ts
updatePaperCount: (bucketKey, nextCount, cap) =>
  set((state) => {
    const item = state.items[bucketKey];
    if (!item) return state;
    const clamped = Math.max(0, Math.min(cap, Math.floor(nextCount)));
    if (clamped === (item.paperCount ?? 0)) return state;
    const readyDelta =
      item.status === "ready"
        ? clamped - (item.paperCount ?? 0)
        : 0;
    return {
      items: { ...state.items, [bucketKey]: { ...item, paperCount: clamped } },
      readyCount: state.readyCount + readyDelta,
    };
  });
```

**Done when.** Tests green; existing bucket tests still pass.

---

### Phase E — UI

#### Task 7 — `<CountChip>` component

**Why.** Visible surface of the feature. Encapsulates the SWR hook, store
write, and every UX state (loading, cached, clamped, error).

**Test first.** `components/extraction/bucket/__tests__/count-chip.test.tsx`:

1. **Initial render, loading.** Mock `useHistoryCount` → `{ isLoading:
   true, count: undefined }`. Assert chip shows the provided `paperCount`
   value in the trigger label. Open popover: assert `SkeletonBar` rendered
   next to "available".
2. **Resolved, fresh > cached.** Mock → `{ count: 5000 }`, `cap: 200`,
   `entry.count: 3000`. Open popover. Assert stepper max is 200; assert
   "5,000 available" rendered; assert "cap applies" hint visible.
3. **Resolved, fresh < stepper.** Mock → `{ count: 120 }`, `paperCount:
   200`. Assert on first render after resolve, `updatePaperCount(key, 120,
   cap)` was called (clamp on mount).
4. **Preset click — 50.** Fire click on the "50" preset. Assert
   `updatePaperCount(key, 50, cap)` called once.
5. **Preset click — Max.** With fresh=120, cap=200. Click "Max". Assert
   `updatePaperCount(key, 120, cap)` called (Max is `min(cap, fresh)`).
6. **Stepper −/+ buttons.** With `paperCount: 100`, click `+`. Assert
   `updatePaperCount(key, 101, cap)`.
7. **Input commit on blur.** Type `75`, blur. Assert
   `updatePaperCount(key, 75, cap)`.
8. **Input commit clamped.** Type `999`, blur. `cap: 200`. Assert
   `updatePaperCount(key, 200, cap)`.
9. **Error + cached fallback.** Mock → `{ error: Error("boom"), count:
   undefined }`, `entry.count: 300`. Assert "(cached)" tag rendered;
   stepper max is `min(cap, 300)`.
10. **a11y.** Assert trigger's `aria-label` mentions both count and query.
    Assert input has `role="spinbutton"` and correct
    `aria-valuemin/max/now`. Assert popover live region announces on
    commit.

**Implementation.** `components/extraction/bucket/count-chip.tsx` per §5f.
Use `useBucketStore((s) => s.updatePaperCount)` (atomic selector — P5 §5a).
Use `useFormatter()` from `next-intl` for `formatter.number(n)`. Use
`Badge`, `Popover*`, `SkeletonBar`, and `Input` from the primitives list.
Compose the segmented preset row by hand (mirrors `CompactIconToggleGroup`
styling).

**Done when.** All 10 test cases green; manual smoke confirms keyboard
(↑/↓/PageUp/PageDown/Home/End) works in the stepper.

---

### Phase F — Wiring

#### Task 8 — Wire `<CountChip>` into history rows + replace stale-count math

**Why.** The whole plan hinges on this integration.

**Test first.** `components/extraction/__tests__/history-selector.test.tsx`
(extend if present, else create):

1. **Unselected row — no chip.** Render `<HistorySelector>` with one
   history entry, nothing selected. Assert no `<CountChip>` rendered.
2. **Selected row — chip present.** Toggle selection. Assert a
   `<CountChip>` renders within that row. Assert it receives
   `bucketKey`, `paperCount`, `cap`, `defaultCount`, and `entry`.
3. **Selection summary uses bucket paperCount, not entry.count.**
   - Seed a history entry with `entry.count: 500`.
   - Select it. Mock `useHistoryCount` → `{ count: 120 }`. Wait for the
     post-mount clamp to settle (paperCount becomes 120).
   - Assert the summary line reads "120 papers from 1 search", not "500".
4. **Deselection removes chip.** Toggle off. Assert chip unmounts (no more
   hanging SWR request after cleanup).

**Implementation.**

1. `components/extraction/history-selector.tsx`:
   - Add `useQuery(api.extraction.bucket.queries.getMyPaperPullCap)` +
     `getMyPaperPullDefault`. Both fall back to `200` while loading
     (keeps UI responsive; real value arrives post-mount).
   - In the row renderer, when the entry is selected, render `<CountChip>`
     with props from §5f. Grab the `bucketKey` from
     `fromSavedSearchQuery(entry).bucketKey` (or via a
     `bucket.items[key]` lookup keyed on the stable source signature).
   - Update the `selectedPaperCount` computation (lines 33-41) to read
     `BucketItem.paperCount` for selected entries, via a
     `useBucketStore` atomic selector that returns an array of staged
     paperCounts keyed by the selected entry ids. DRY against the
     `readyCount` field where possible (but note: `readyCount` excludes
     non-ready items; the selection preview wants ALL selected,
     regardless of status).
2. Delete the `?? entry.count ?? 0` fallback in `fromSavedSearchQuery`
   ONLY IF the runtime clamp covers the cold-start race. Otherwise keep
   as fallback initial value but ensure every downstream consumer reads
   the post-clamp `paperCount`. Verdict: **keep** the fallback at
   `fromSavedSearchQuery(entry)` (cold-start protection) but the very
   next render `<CountChip>` either (a) finishes loading and clamps, or
   (b) leaves the fallback intact if fresh ≥ fallback ≥ cap.

**Done when.** Tests green; smoke in a running browser (see §9) confirms
selecting a history row shows the chip, clicking it opens the popover,
presets + stepper all commit, bucket indicator updates live.

---

### Phase G — Polish

#### Task 9 — Polite-pool mailto header

**Why.** We're about to start hitting OpenAlex with count queries every
time a user toggles a history row. Be a good citizen; register with the
polite pool for priority + higher rate limits.

**Test first.** None — config glue.

**Implementation.**

1. Inspect `node_modules/@sickrin/openalex-sdk/dist/` for how the SDK
   accepts a mailto (constructor option vs. per-call param).
2. Thread `process.env.OPENALEX_CONTACT_EMAIL` through in `lib/openalex.ts`.
3. Add to `.env.local.example` with a comment linking the polite-pool
   docs.

**Done when.** A manual `curl` equivalent of one count call shows the
`mailto` query param (or header) populated. Skip if SDK exposes no
mechanism; in that case, deliberately defer and file as P7a.

---

#### Task 10 — i18n

**Why.** Every user-facing string in `<CountChip>` needs a key. Non-EN
locales break otherwise.

**Test first.** None. Smoke: switch the app locale; assert the chip
renders localised text.

**Implementation.** Add to each of `messages/{en-US,en-GB,fr,hi,ja,zh}.json`:

```json
"extraction": {
  "countChip": {
    "papersLabel": "{count, number} {count, plural, one {paper} other {papers}}",
    "title": "Papers to import",
    "available": "{count, number} available",
    "capApplies": "cap applies",
    "cached": "cached",
    "refreshError": "Couldn't refresh count",
    "refresh": "Refresh",
    "presetFifty": "50",
    "presetHundred": "100",
    "presetMax": "Max",
    "liveAnnouncement": "Papers set to {count, number}"
  }
}
```

Use machine translation + a native-speaker follow-up note for locales
with ambiguous plural rules (ja doesn't pluralise; the plural form can
collapse).

**Done when.** Build green; each locale file parses; smoke in en-US + fr
shows localised text.

---

## 7. Migration & destructiveness checklist

- [ ] `PAPER_PULL_CAP_BY_PLAN` + `PAPER_PULL_DEFAULT_BY_PLAN` tables +
      `getPaperPullCap` + `getPaperPullDefault` helpers in `limits.ts`.
- [ ] `getMyPaperPullCap` + `getMyPaperPullDefault` Convex queries.
- [ ] `lib/openalex/filter-hash.ts` exported; tests cover determinism,
      sensitivity, and excluded-field independence.
- [ ] `lib/openalex/count.ts` exported; tests cover per-page=1, meta.count
      extraction, error shape.
- [ ] `lib/utils.ts::createSearchParameters` accepts
      `{ perPageOverride?: number }`; default behaviour unchanged.
- [ ] `app/actions/openalex-count.ts::searchOpenAlexCount` server action.
- [ ] `lib/hooks/use-history-count.ts` with SWR key =
      `["openalex-count", filterHash]`, dedup 60_000, `refresh` exposed.
- [ ] `lib/store/bucket.ts::updatePaperCount(bucketKey, n, cap)` maintains
      `readyCount` invariant; tests green.
- [ ] `components/extraction/bucket/count-chip.tsx` renders trigger +
      popover + stepper + presets + skeleton + cached-fallback.
- [ ] `components/extraction/history-selector.tsx` mounts `<CountChip>`
      only on selected rows; selection summary uses staged `paperCount`,
      not `entry.count`.
- [ ] `messages/{en-US,en-GB,fr,hi,ja,zh}.json` include
      `extraction.countChip.*` strings.
- [ ] Polite-pool mailto wired (or P7a filed with reason).
- [ ] `knip` clean.
- [ ] Full test suite green at every commit.

---

## 8. Files inventory

### New

- `convex/extraction/bucket/__tests__/paperPullLimits.test.ts`
- `lib/openalex/filter-hash.ts`
- `tests/openalex/filter-hash.test.ts`
- `lib/openalex/count.ts`
- `tests/openalex/count.test.ts`
- `app/actions/openalex-count.ts`
- `tests/app/actions/openalex-count.test.ts`
- `lib/hooks/use-history-count.ts`
- `tests/hooks/use-history-count.test.tsx`
- `components/extraction/bucket/count-chip.tsx`
- `components/extraction/bucket/__tests__/count-chip.test.tsx`
- `components/extraction/__tests__/history-selector.test.tsx` (if absent)

### Modified

- `convex/extraction/bucket/limits.ts` — add the two new tables + two
  helpers.
- `convex/extraction/bucket/queries.ts` — add `getMyPaperPullCap` +
  `getMyPaperPullDefault`.
- `lib/utils.ts` — `createSearchParameters` accepts optional
  `perPageOverride`.
- `lib/openalex.ts` — polite-pool mailto wiring.
- `lib/store/bucket.ts` — add `updatePaperCount`.
- `tests/store/bucket.test.ts` — extend with 6 new cases.
- `components/extraction/history-selector.tsx` — render `<CountChip>` on
  selected rows; rewire selection summary math.
- `messages/{en-US,en-GB,fr,hi,ja,zh}.json` — add chip strings.
- `.env.local.example` — add `OPENALEX_CONTACT_EMAIL` note.

### Deleted

Not applicable as whole-file deletions. Specific line removals:

- If Task 8 confirms the cold-start fallback in `fromSavedSearchQuery` is
  redundant, delete the `entry.count ?? 0` branch. Otherwise leave and
  document the reason inline (once — no comment flood).

---

## 9. Test strategy

- **Unit** (Tasks 1-6, 9): Vitest; `@testing-library/react` + jsdom for
  component and hook tests; `vi.mock` inline for every external dep
  (`@sickrin/openalex-sdk`, `@/app/actions/openalex-count`, SWR, Convex
  `useQuery`, `next-intl`).
- **Convex** (Task 1): `convex-test` + edge-runtime env from
  `vitest.config.ts`. Seed a `users` row + optional `subscriptions` row;
  call the query via the test harness; assert the returned number.
- **Integration** (Tasks 7, 8): Render `<HistorySelector>` with a mocked
  bucket store (get actual store, call `.clear()` + seed); mock the SWR
  hook module so the test controls `isLoading / count / error`. Assert
  DOM state + store calls.
- **E2E smoke** (post-Task 8): Playwright or manual — mount the extraction
  page with one history entry, select it, open the chip popover, pick a
  preset, submit the job. Verify the submitted `searchFilters` carries
  the chosen limit into the extraction pipeline (`convex/extraction/
  actions.ts::fetchPapersFromHistory`). **Not required to land this plan
  — but ticket as a P7-verify-e2e sibling if not executed inline.**

Baseline: **current suite (as of P6 tail) green.** Every task leaves it
green or adds tests that do.

---

## 10. Open items (flag to user before starting)

1. **`fetchPapersFromHistory` honoring the chosen N.** Today
   `convex/extraction/actions.ts:18-78` hardcodes `per-page: 200` via
   `lib/openalex/search-params.ts:117`. This plan changes the UI so the
   user picks N ≤ 200 — but unless the submit-time action **reads** that
   N, the choice is cosmetic. Default: **add a sibling task inside Task 8**
   threading `limit?: number` through `searchFiltersValidator` +
   `buildOpenAlexSearchParams` +
   `fetchPapersFromHistory`. Ask the user to confirm before starting.

2. **Filter hash excluded fields.** §5b excludes `screeningQuestions` and
   `queryHistory`. Confirm these never change the OpenAlex query — if they
   do (e.g., a `queryHistory` entry adds an AND clause), the hash is
   broken. Audit by reading `createSearchParameters` end-to-end; if any
   field slips through, add it to the allow-list.

3. **Cold-start UX when `getMyPaperPullCap` is loading.** §Task 8 falls
   back to `200` while Convex `useQuery` resolves. Alternative: render
   the chip as disabled skeleton until the cap lands. Default: **fallback
   to 200** (it's the only value today anyway). Revisit when per-plan caps
   diverge.

4. **Mailto availability.** If the SDK has no mailto hook, Task 9 files
   P7a and proceeds without. Ask the user before deferring, since it's a
   good-citizen concern with measurable impact at scale.

5. **SWR provider — install or per-hook config?** §4c / §5d use per-hook
   config (matches existing search provider). If the user wants a
   top-level `SWRConfig` with shared defaults (dedup, retry, no auto-
   revalidate), add as P7b — affects every existing SWR call site. Default:
   **per-hook**.

6. **Cursor pagination for >200.** §1 scope boundary. User confirmed
   "ignore for now, cap at 200." When the user is ready to lift the cap,
   ticket as P8 — the config tables in this plan are the single edit
   point.

None of these are blockers. Start at Task 1.
