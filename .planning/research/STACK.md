# Stack Research — v7.0 Extraction Workbench

**Domain:** Next.js 15 + Convex literature-screening SaaS — adding a results workbench, cross-source paper selection, Zotero revival, and per-tier paper limit.
**Researched:** 2026-04-15
**Confidence:** HIGH (Zotero, TanStack, nuqs, shadcn verified against current npm + official docs dated 2025-09 or later; only TanStack Table v9 timing is LOW because it is a moving-target alpha)

---

## TL;DR — Decision Summary

| Question | Recommendation | Net New Dependency |
|----------|----------------|--------------------|
| Results workbench table library | **Raw `@tanstack/react-table` v8.21.3 + shadcn primitives** (re-install `table.tsx`). Reject shadcn `data-table` block as-is; reject AG Grid / react-data-grid. | `@tanstack/react-table@^8.21.3` (new) + re-add `components/ui/table.tsx` via `npx shadcn@latest add table` |
| Cross-source selection basket | **Zustand via existing `createSidebarStore`-factory pattern** — write a new `createSelectionBasketStore` factory. Do not introduce a cart library. | None |
| Zotero API client | **Keep the existing OAuth 1.0a implementation in `convex/zotero/**` — Zotero has NOT migrated.** Do NOT adopt `zotero-api-client` (it only does API-key auth, skipping OAuth, and adds Node + browser surface your Convex actions don't need). | None |
| Per-tier paper limit | **Extend the existing `PLAN_CONFIG` object in `convex/lib/constants.ts`** with a `maxExtractionPapers` field. Do NOT add `@vercel/flags`, Unleash, or GrowthBook. | None |
| 1000-row virtualization | **Not yet needed.** 1000 rows render fine in TanStack Table without `@tanstack/react-virtual`. Defer virtualization until a profile shows jank. | None (optional future: `@tanstack/react-virtual@^3.13.23`) |

**Net new runtime deps: 1** (`@tanstack/react-table`).
**Net new dev files: 1** (`components/ui/table.tsx` re-added via shadcn CLI).

---

## Core Technology Decisions

### 1. Results workbench table: TanStack Table v8 + shadcn primitives (NOT the shadcn "data-table" block, NOT AG Grid)

| Library | Version | Purpose | Verdict |
|---------|---------|---------|---------|
| `@tanstack/react-table` | **8.21.3** (released 2026-04-09) | Headless table engine (sort, filter, column visibility, pagination, row selection, faceted filters) | **ADOPT** |
| `@tanstack/table-core` | 8.21.3 | Core, dependency of react adapter | Transitive |
| shadcn `<Table />` primitive (`components/ui/table.tsx`) | latest via `npx shadcn@latest add table` | Styled tr/td/thead wrappers over native HTML table | **ADOPT** (re-install — was deleted) |
| `@tanstack/react-virtual` | 3.13.23 | Row virtualization | **DEFER** — only add if 1000 rows profile poorly (see §Virtualization below) |

**Peer-dep confirmation:** `@tanstack/react-table@8.21.3` declares `peerDependencies: { react: ">=16.8", react-dom: ">=16.8" }`. Your `react@^19.2.4` and `react-dom@^19.2.4` are compatible — no overrides, no `--legacy-peer-deps` needed. Verified via `npm view @tanstack/react-table peerDependencies`.

**Why this approach over alternatives:**

| Alternative | Why rejected |
|-------------|--------------|
| **shadcn `data-table` block** (the copy-paste `columns.tsx`/`data-table.tsx`/`toolbar.tsx` tutorial from ui.shadcn.com/docs/components/data-table) | This is literally what v6.0 deleted in `components/data-table/**` (data-table.tsx, toolbar, pagination, column-header, action-bar, faceted-filter, date-filter, slider-filter, range-filter, view-options). The block is **a pattern, not a component** — shadcn explicitly frames it as "a guide on how to build your own." There is no upgrade, just a one-time copy. You already know the pattern; re-copying it into `components/data-table/**` buys nothing that writing your own workbench-specific `ExtractionResultsTable` doesn't. **The MILESTONE-SPECIFIC reason to reject** is that the shadcn block's `data-table.tsx` component is monolithic — toolbar, table, pagination in one file — which fights a four-view workbench where the table is one of four equivalent views, all sharing the same toolbar. Better: keep the shadcn `<Table />` primitive, write your own `ExtractionResultsWorkbench` shell that owns the shared toolbar, and let the four views each consume the same `useReactTable(...)` instance. |
| **AG Grid Community** (`ag-grid-community@35.2.1`) | (a) Bundle size: AG Grid Community ships ~500KB min+gz — a regression after v3.0's ~500KB ExcelJS dynamic-import savings. (b) Its default styling fights Tailwind v4 + shadcn OKLCH tokens — you'd re-skin everything. (c) Enterprise features (master-detail, server-side row model) you don't need. (d) AG Grid's column-pinning and filter UI is at odds with the brand spec ("warm, approachable, not enterprise"). |
| **react-data-grid** (`react-data-grid@7.0.0-beta.59`) | Still in **beta after 4 years** — the v7 beta has been around since 2022. Low release cadence is an anti-signal. Also: its cell-editing model is geared to spreadsheets, not screening workbenches. |
| **TanStack Table v9** (`9.0.0-alpha.32`) | v9 is in **alpha since 2024**; per TanStack lead Kevin Van Cott (Dec 2025 X post), "It's going to be a challenge to actually organize and ship everything in 2026." V9 also targets the React Compiler, which you don't currently use (`babel-plugin-react-compiler@^1.0.0` is in devDeps but you're not on `reactCompiler: true`). Stick with 8.x. |
| **Material React Table** | Pulls MUI. Incompatible with your Tailwind v4 + shadcn foundation. Hard reject. |
| **Mantine DataTable** | Same reason: needs Mantine UI. |

**Why TanStack Table v8 handles 1000 rows + 4 views:**

1. **1000 rows without virtualization:** Modern browsers comfortably render 1000 DOM `<tr>` rows on mid-range hardware. TanStack Table's row-model is O(n) for sort, O(n) for filter, and all derived state is memoized. The LogRocket and openstatus reference implementations do not virtualize at 1000 rows; they start virtualizing at 10,000+.
2. **Four views from one table instance:** The `useReactTable(...)` hook returns a `table` object that exposes `getRowModel()`, `getSortedRowModel()`, `getFilteredRowModel()`, `getPaginationRowModel()`. You instantiate once in `ExtractionResultsWorkbench`, then pass `table` to `TableView`, `CardView`, `SplitView`, `HighlightedCitationView` — each view reads `table.getRowModel().rows` and applies its own rendering. Sort/filter/pagination state lives in the hook, so switching views preserves selection and filters.
3. **Column visibility for multi-view:** Each view declares which columns it wants visible via `table.getColumn(id)?.toggleVisibility(...)` on mount. This is the idiomatic pattern.

**Proven production references for this exact stack** (Next.js + React 19 + shadcn primitive + TanStack v8 + nuqs URL state):

- `openstatus/data-table` — filter-heavy reference table with 10 filter types, URL state, client + server variants.
- `sadmann7/tablecn` — shadcn + TanStack v8 + nuqs with server-side sort/filter/pagination.
- `shadcn-table` by the same author — server-side-first version.

Use these as reference implementations, not as dependencies. Copy patterns, not packages.

---

### 2. Cross-source selection basket: Zustand via `createSelectionBasketStore` factory

**Recommendation:** Write a new factory `createSelectionBasketStore(persistKey)` next to the existing `createSidebarStore` in `lib/store.ts`. Do NOT introduce a dedicated "cart" library.

**State shape:**

```ts
// lib/store.ts — append near createSidebarStore
interface SelectionBasketState {
  // Map<openalexId, SelectedPaper> — deduped by OpenAlex ID across all sources
  selectedPapers: Record<string, {
    openalexId: string;
    title: string;
    authors: string[];
    year?: number;
    source: "library" | "collection" | "search" | "manual" | "zotero";
    sourceContext?: { collectionId?: string; zoteroKey?: string; /* ... */ };
    addedAt: number;
  }>;
  addPapers: (papers: SelectedPaper[]) => void;
  removePaper: (openalexId: string) => void;
  toggleSelection: (paper: SelectedPaper) => void;
  clear: () => void;
  getCount: () => number;
  getByOpenalexIds: (ids: string[]) => SelectedPaper[];
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
}

export function createSelectionBasketStore(persistKey: string) {
  return create<SelectionBasketState>()(
    persist(
      (set, get) => ({ /* ... dedupe-by-openalexId implementation ... */ }),
      {
        name: persistKey,
        version: 1,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({ selectedPapers: state.selectedPapers }),
        onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
      }
    )
  );
}

export const useExtractionBasketStore = createSelectionBasketStore("openalex-extraction-basket");
```

**Why this is the right fit (not a cart library):**

| Alternative | Why rejected |
|-------------|--------------|
| `use-shopping-cart`, `react-use-cart` | E-commerce libraries — line items, SKUs, quantities, taxes, checkout. Your "basket" has none of this: it's a Set-by-id with source metadata. Using an e-commerce library forces adapter code and adds a dependency for 20 lines of state. |
| Convex-persisted selection | Wrong place. Selection is ephemeral UX state that the user builds up over minutes, across tabs, across sessions. Persisting to Convex means round-tripping every click through the backend; localStorage persistence via Zustand's `persist` middleware gives instant optimistic updates and offline resilience. The user's cart survives Convex being down, which is the correct failure mode. |
| `jotai` or `valtio` atoms | You already have Zustand 5.0.5. Introducing a second state manager for one store is a DRY violation. |
| Context + reducer | No persistence across navigation, no DevTools, verbose. Zustand already solved these. |

**Integration with existing infrastructure:**

- **Factory pattern mirrors `createSidebarStore`** — same `persist` + `version` + `migrate` + `partialize` + `_hasHydrated` conventions, so code review is mechanical.
- **`_hasHydrated` gate** — prevents the "1 / 1000" counter from flashing "0" on first render (the existing pattern you use for sidebar collapse).
- **URL state via nuqs** is a bad fit for the basket itself (1000 IDs × ~10 chars = 10KB URL, browser limits apply), but nuqs IS the right choice for the **active source tab + search query in the picker** — that's already your library/search page pattern.

**Cart overlay animation: `motion/react` v12 (already installed) — no new deps.**

- `motion` v12 is the new name for Framer Motion; `motion/react` is the React entry. You're on `motion@^12.23.12` which ships the spring presets your brand spec asks for.
- The reviewer asked "any new deps needed for a 'selected papers' cart overlay (react-use-gesture? framer-motion helpers?)". **Answer: no.** `motion/react` has built-in `AnimatePresence`, `useDragControls`, and `useSpring` — everything a slide-up basket sheet needs. Adding `@use-gesture/react` on top of `motion` is a 2023 pattern; Motion v12 has drag/pan built in.

---

### 3. Zotero API integration: keep existing OAuth 1.0a implementation, do not adopt a client library

**Critical fact (HIGH confidence, verified 2026-04-15 against official Zotero docs last modified 2025-09-24):**

> **Zotero currently supports only OAuth 1.0a.** OAuth 2.0 is described as future functionality with no announced date. The existing `convex/zotero/actions.ts` — which uses `crypto.createHmac("sha1")` and `HMAC-SHA1` signing — is STILL correct for 2026.

Source: <https://www.zotero.org/support/dev/web_api/v3/basics> (doc date 2025-09-24; verified no API v3 deprecation or v4 announcement exists).

**Endpoints remain correct** (verified same source):

- `GET /users/{userID}/items` — user library items
- `GET /users/{userID}/collections/{collectionKey}/items` — items in a collection
- `GET /groups/{groupID}/items` — group library items
- `GET /users/{userID}/collections` — list collections

**Authentication options** (any of these work with the existing encrypted-at-rest API key):

1. `Zotero-API-Key: <key>` header (recommended)
2. `Authorization: Bearer <key>` header
3. `?key=<key>` query param (NOT recommended)

The existing code uses Option 2 via `buildZoteroHeaders` in `lib/zotero-utils` — correct and current.

**Rate limits** (advisory, no published numbers):

- Respect `Backoff: <seconds>` response header (temporary slow-down)
- Respect `429 Too Many Requests` + optional `Retry-After: <seconds>` header (hard limit)
- Pagination: `limit` max is **100 per page** — existing paginated fetch logic in `convex/zotero/actions.ts` should verify it's using `limit=100` + `start=N` cursoring.

**Why NOT `zotero-api-client` (by @tnajdek, v0.48.0, ~929 weekly downloads):**

| Concern | Detail |
|---------|--------|
| **Wrong auth scope** | Per README: supports ONLY API-key auth. It does not implement OAuth 1.0a at all. So importing it does not help you with the hard part (OAuth flow in `startOAuth` / `completeOAuth`). You'd still need your 200+ LoC of HMAC-SHA1 signing code. |
| **Redundant with fetch** | Once you have the API key, Zotero v3 is just `GET https://api.zotero.org/<prefix>/items?limit=100&start=<n>` with a header. The `zotero-api-client` adds a fluent chain wrapper (`api().library('user', 475425).items().get()`) around 1 line of `fetch()`. Zero value. |
| **Convex action environment** | `zotero-api-client` ships ESM + UMD for Node/browser. Convex `"use node"` actions run in Convex's Node runtime — works, but introduces a dependency for UMD code you'll never use. |
| **Maintenance signal** | v0.48.0 after 8 years (2017 → 2026). Pre-1.0, breaking changes possible. The official Zotero org (`github.com/zotero/zotero-api-node`) has a different package called `zotero` that last saw active development in ~2016. |
| **Your existing code is good** | The 1124 LoC in `convex/zotero/actions.ts` already handles request token → authorize URL → access token → fetch items/collections/groups, with encryption-at-rest (AES-256-GCM via `convex/lib/crypto.ts`), `cleanupExpiredOAuthTokens` cron, and audit logging. **This code is orphaned in v7.0 because it's disconnected from UI, not because it's broken.** Revival = wire the UI, not rewrite the backend. |

**Related OAuth 1.0a libraries (for reference, DO NOT add):**

- `oauth-1.0a@2.2.6` — last published 2019-06-05, stale. Your hand-rolled HMAC-SHA1 in `convex/zotero/actions.ts` is maintained by you and battle-tested by the cleanup cron.
- `passport-oauth1` — Express middleware, incompatible with Convex action model. Not applicable.

**What DOES need to change in `convex/zotero/**` for revival (scope for roadmap):**

1. **Wire UI** — Settings page connect card + a Zotero tab in the new cross-source picker.
2. **Verify pagination cursor semantics** — confirm `start=N&limit=100` is used correctly across all 4 endpoint handlers (users/items, groups/items, collections, collection items).
3. **Type updates to match extractionJobs schema** — the Zotero→SelectedPaper adapter returns objects that match the new basket state shape (openalexId + source metadata). Note: **Zotero items don't always have OpenAlex IDs.** You'll need a resolution step: DOI → OpenAlex work ID via `@sickrin/openalex-sdk@^1.0.0` (already in deps), or skip items with no DOI.
4. **Add `maxExtractionPapers` hard reject** — see §4 below.

---

### 4. Per-tier paper limit: extend `PLAN_CONFIG`, reject feature-flag libraries

**Recommendation:** Extend the existing `PLAN_CONFIG` object in `convex/lib/constants.ts` with `maxExtractionPapers`. Add the same constant to `convex/lib/queryBounds.ts` as `MAX_EXTRACTION_PAPERS_PER_JOB` set to the pro-tier value (1000) for the schema/validator layer. Wire the tier-specific limit in `createExtractionJob`.

**Concrete shape:**

```ts
// convex/lib/constants.ts — extend PLAN_CONFIG
export const PLAN_CONFIG = {
  free:       { creditsPerMonth: 0,       tier: 0,  freeCreditCap: 500,     maxExtractionPapers: 100 },
  go:         { creditsPerMonth: 3_000,   tier: 10, freeCreditCap: 6_000,   maxExtractionPapers: 500 },
  pro:        { creditsPerMonth: 15_000,  tier: 20, freeCreditCap: 30_000,  maxExtractionPapers: 1_000 },
  enterprise: { creditsPerMonth: 150_000, tier: 30, freeCreditCap: 300_000, maxExtractionPapers: Number.POSITIVE_INFINITY },
} as const;

export function getMaxExtractionPapers(plan: PlanType): number {
  return PLAN_CONFIG[plan].maxExtractionPapers;
}
```

```ts
// convex/lib/queryBounds.ts — bump to the pro ceiling for the schema layer
// This is the ABSOLUTE MAX — per-tier enforcement lives at mutation boundary.
export const MAX_EXTRACTION_PAPERS_PER_JOB = 1_000; // was 200 in v6.0
```

**Why not a feature-flag / entitlements library:**

| Library | Version (current as of 2026-04-15) | Why rejected |
|---------|------------------------------------|--------------|
| `@vercel/flags` / `flags` | `flags@4.0.6` | Designed for A/B rollouts and marketing experiments, not subscription entitlements. Adds Edge Config or provider state. You already have plan state in Convex `subscriptions` table; introducing a parallel flag store is two sources of truth. |
| `@growthbook/growthbook` | `1.6.5` | Same category — experimentation / A/B. Useful for "should user see new UI?", not "can user create a 1000-paper job?". |
| `unleash-client` | `6.10.1` | Enterprise feature-flagging with strategies. Overkill for a 4-key lookup table. Self-hosted Unleash requires Docker infra you don't have. |
| LaunchDarkly, Statsig | — | SaaS subscription cost. Hard reject for a config change. |

**Your existing billing setup already has every primitive needed:**

1. **`PLAN_CONFIG`** (convex/lib/constants.ts:27-32) is an `as const` object indexed by plan name — perfect for adding one more numeric field.
2. **`PlanType`** is already derived: `type PlanType = keyof typeof PLAN_CONFIG`.
3. **`resolveEffectivePlan(subscription)`** in `lib/billing/entitlements.ts` already returns `"free" | "go" | "pro" | "enterprise"` for entitled / non-entitled status — use this in `createExtractionJob` to read the caller's effective plan.
4. **`createExtractionJob`** can then do:
   ```ts
   const plan = resolveEffectivePlan(subscription);
   const maxForPlan = getMaxExtractionPapers(plan);
   if (papers.length > maxForPlan) {
     throw createError(
       "PAPER_LIMIT_EXCEEDED",
       `Your ${plan} plan allows up to ${maxForPlan} papers per job. Reduce selection or upgrade.`
     );
   }
   ```

**Client-side "X / limit" counter** reads the current plan from the existing `useSubscription` / `useProtectedQuery(api.subscriptions.getCurrent)` — whatever your library page uses for the credit banner. No new hooks.

**Why `Number.POSITIVE_INFINITY` for enterprise:** Clean sentinel, works with `papers.length > limit`, and never crosses a Convex validator boundary because the check is server-side only. If you need to serialize the limit for UI display, translate at render: `Infinity → "Unlimited"`. Alternatively, use a large finite number like `10_000` for enterprise to avoid any Infinity edge cases — your call during implementation.

---

## Existing Stack (Unchanged — FOR REFERENCE)

These are validated and carry forward. **DO NOT re-research.**

| Technology | Current Version | Role in v7.0 |
|------------|-----------------|--------------|
| `next` | `^16.1.6` | App Router, RSC boundary for `/extraction/[jobId]/page.tsx` (server-fetch, pass to client) |
| `react` / `react-dom` | `^19.2.4` | No special handling needed — TanStack Table v8 and shadcn primitives are React-19 compatible |
| `typescript` | `^5` | strict mode, zero `any` — column defs get branded types from Convex validators |
| `convex` | `^1.34.1` | Backend, queries, mutations, workflow |
| `@convex-dev/workflow` | `^0.3.9` | Existing extraction workflow — unchanged |
| `@convex-dev/workpool` | `^0.3.2` | Existing `extractionPool` — unchanged |
| `zustand` | `^5.0.5` | Used for new `createSelectionBasketStore` factory |
| `nuqs` | `^2.6.0` | Picker tab / search / filter URL state — existing pattern |
| `motion` | `^12.23.12` | Basket drawer / view-switch animations — built-in drag / spring |
| `@clerk/nextjs` | `^6.38.2` | Auth — unchanged |
| `next-intl` | `^4.8.2` | Add keys to all 6 locales (en, fr, es, de, ar, zh) |
| `sonner` | `^2.0.7` | Toast the `PAPER_LIMIT_EXCEEDED` error |
| `lucide-react` | `^0.487.0` | Icons for view switcher, basket, sources |
| `radix-ui` | `^1.4.3` | Monolith — already in deps, supports `react ^19.0` |
| `class-variance-authority` | `^0.7.1` | `cva` for view-switcher button variants |
| `tailwindcss` | `^4` | OKLCH tokens |
| `zod` | `^4.3.6` | Validators on basket shape and limit check |
| `fastest-levenshtein` | `^1.0.16` | Citation grounding (unchanged from v6.0) — drives HighlightedCitationView slicing |
| `convex-helpers` | `^0.1.114` | Rate-limiting via `defineRateLimits` — existing |
| `ulid` | `^3.0.2` | Trace IDs — existing |

---

## Net New Dependencies

### Runtime (`dependencies`)

```bash
# ONE new runtime dependency
pnpm add @tanstack/react-table@^8.21.3
```

**That's it.**

- `table-core` comes as a transitive dependency.
- Virtualization is deferred (see §Virtualization Not Yet Needed below).
- No Zotero library.
- No cart library.
- No feature-flag library.
- No new animation library.

### shadcn primitive (not an npm dep — a code generation)

```bash
# Re-add the <Table /> primitive file that v6.0 deleted
pnpm dlx shadcn@latest add table
```

This writes `components/ui/table.tsx` — a thin wrapper over native `<table>`/`<thead>`/`<tr>`/`<td>` with Tailwind utility classes. You own the file; it is not an npm dependency.

### Dev dependencies

**None.** Your existing Vitest + Playwright + `@testing-library/react` handle the new components without additions.

---

## Architecture Notes (Cross-References for FEATURES.md and ARCHITECTURE.md)

### The workbench is a single `useReactTable` with four views

```
/app/extraction/[jobId]/page.tsx (Server Component)
  └─ fetches job + results via server-side Convex query
     └─ <ExtractionResultsWorkbench results={results} /> (Client Component)
        ├─ const table = useReactTable({ data: results, columns, ... })
        ├─ <WorkbenchToolbar table={table} /> — shared: view switcher, search, filters, column visibility, pagination
        └─ <ViewSwitcher>
           ├─ <TableView      table={table} />   (uses table.getRowModel(), renders <Table />)
           ├─ <CardView       table={table} />   (uses table.getFilteredRowModel(), renders cards)
           ├─ <SplitView      table={table} />   (left: compact list, right: detail panel)
           └─ <HighlightedCitationView table={table} />  (renders verbatim `slice()` with citation highlights)
```

**One table instance, four render functions.** Sort, filter, search, column visibility, pagination are all in the hook's state and apply across all views simultaneously. Switching views preserves state by construction.

### The basket is a store, not a prop

```
Zustand store (lib/store.ts):
  useExtractionBasketStore — singleton across all source tabs and pages

Usage:
  - Library page → "Add N papers" button → store.addPapers(selected)
  - Search page → same
  - /extraction/new picker → Zotero tab → store.addPapers(mapped)
  - Floating basket drawer (motion/react slide-up Sheet) → renders store.selectedPapers
  - ExtractionDialog → reads store.selectedPapers on open, passes as `papers` prop to createExtractionJob
```

**This solves UI-01** (the v6.0 gap where `ExtractionDialog papers prop is never passed`): the dialog now reads from the store on open, so job creation is reachable from any source.

### The Zotero revival is a wiring problem, not a crypto problem

The OAuth 1.0a code is already correct. What changes:

1. **New route**: `app/(dashboard)/settings/integrations/zotero/page.tsx` — "Connect Zotero" button that calls `startOAuth` action, redirects to `authorizeUrl`, handles callback via `completeOAuth`.
2. **New picker tab**: `components/extraction/picker/zotero-source-tab.tsx` — lists collections/groups/items using the existing `convex/zotero/queries.ts` and `actions.ts` endpoints.
3. **Unchanged**: `convex/zotero/actions.ts` signing, `convex/lib/crypto.ts` encryption, `cleanupExpiredOAuthTokens` cron, `resolveZoteroApiKey` audit logging.

---

## Virtualization: Not Yet Needed (Defer)

**Claim:** 1000 rows render fine in TanStack Table v8 without `@tanstack/react-virtual`.

**Evidence:**

- The official TanStack Table docs feature a "Virtualized Rows" example that only becomes necessary for 10,000+ rows.
- openstatus and sadmann7/tablecn reference implementations don't virtualize at 1000.
- A typical `<tr>` with 8–10 columns costs ~0.5KB of DOM. 1000 rows ≈ ~500KB DOM — below the Chrome desktop smoothness threshold.
- Your hard cap is 1000 rows by product rule, not 100,000. There is no scaling cliff.

**When to reconsider:**

- If the HighlightedCitationView renders 1000 verbatim paragraph slices, each with spans for highlights — **that** will benefit from virtualization (not the table itself, but the highlighted-text view). Defer the call until after initial implementation; profile first.
- If a future milestone lifts the hard cap to 10,000+, re-add `@tanstack/react-virtual@^3.13.23` at that time.

**If you add it later:** `@tanstack/react-virtual@3.13.23` declares `peerDependencies: { react: "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0" }` — React 19 is officially supported.

---

## Version Compatibility Matrix

| Package | Version | React 19 | Next 16 | Tailwind 4 | Notes |
|---------|---------|----------|---------|-----------|-------|
| `@tanstack/react-table` | 8.21.3 | ✅ `>=16.8` | ✅ (no Next-specific surface) | ✅ (headless, no styling) | Updated 2026-04-09. Known edge case with React Compiler (#5567) — N/A for you |
| `@tanstack/react-virtual` | 3.13.23 | ✅ `^19.0.0` explicit | ✅ | ✅ | Defer adding |
| `zustand` | 5.0.5 (existing) | ✅ | ✅ | N/A | Factory pattern already in use |
| `motion` | 12.38.0 available; you have 12.23.12 | ✅ | ✅ | N/A | Upgrade optional, current works |
| `nuqs` | 2.8.9 available; you have 2.6.0 | ✅ | ✅ (App Router first-class) | N/A | Upgrade optional |
| `shadcn` (CLI) | 4.2.0 available; you have 3.8.5 in devDeps | ✅ | ✅ | ✅ | Only needed to re-add `table.tsx` |
| `@radix-ui/*` individual packages | Superseded by `radix-ui` monolith | ✅ `^19.0` explicit | ✅ | N/A | You already use the monolith — stay on it |

**Known compatibility notes:**

- **React Compiler (off-by-default in your repo):** TanStack Table v8 has a known issue where table state doesn't re-render under React Compiler (issue #5567). You're not using the compiler (no `reactCompiler: true` in `next.config`), so this is N/A.
- **`recharts` react-19 override:** Already handled via `package.json` `overrides` (`react-day-picker` block). If you add more recharts views, the existing override pattern is in place.

---

## Anti-Recommendations: What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **shadcn `data-table` block** (the tutorial copy-paste monolith) | Fights four-view workbench, duplicates logic you'll invariably rewrite. Was already deleted once in v6.0 | Custom `ExtractionResultsWorkbench` that owns the single `useReactTable` instance and passes it to four view components |
| **AG Grid Community** | ~500KB min+gz bundle regression, Tailwind fight, enterprise aesthetic | TanStack Table v8 |
| **react-data-grid** | 4 years in beta, spreadsheet-editing focus | TanStack Table v8 |
| **TanStack Table v9** | Alpha since 2024, React Compiler target, unstable | Stay on v8 until v9 RCs land |
| **Material React Table** / **Mantine DataTable** | Require UI library you don't use | Compose shadcn + TanStack manually |
| **`@tanstack/react-virtual`** (for now) | 1000 rows don't need it; adds complexity | Add only if profile shows jank |
| **`zotero-api-client`** | Only API-key auth, redundant with fetch, no OAuth help | Existing `convex/zotero/actions.ts` |
| **`oauth-1.0a`** (npm) | Last updated 2019; you already have working HMAC-SHA1 | Hand-rolled signing in `convex/zotero/actions.ts` |
| **`@vercel/flags` / Unleash / GrowthBook / LaunchDarkly** | Wrong tool — entitlements not experiments | Extend `PLAN_CONFIG` in `convex/lib/constants.ts` |
| **`use-shopping-cart` / `react-use-cart`** | E-commerce line items, not a paper basket | New `createSelectionBasketStore` factory in `lib/store.ts` |
| **`@use-gesture/react`** | Motion v12 has `drag={true}` and `useDragControls()` built-in | `motion/react` native drag |
| **`jotai` / `valtio`** | Second state manager in one repo | Stay on Zustand |
| **Convex-persisted selection** | Round-trips each click through backend | Zustand localStorage persist |

---

## Installation (Concrete Commands)

```bash
# 1. Install TanStack Table runtime dependency
pnpm add @tanstack/react-table@^8.21.3

# 2. Re-add the shadcn <Table /> primitive (writes components/ui/table.tsx)
pnpm dlx shadcn@latest add table

# 3. NO other new dependencies.

# 4. Verify after install:
pnpm tsc --noEmit
pnpm test
```

**Expected diff after step 1:**

```json
// package.json (dependencies)
+ "@tanstack/react-table": "^8.21.3",
```

**Expected file created after step 2:**

```
components/ui/table.tsx   // re-added; the file v6.0 deleted
```

---

## Stack Patterns by Variant

**If 1000 rows turns out to feel sluggish in profile:**

- Add `@tanstack/react-virtual@^3.13.23`
- Wire `useVirtualizer({ count, getScrollElement, estimateSize: () => 48 })` into TableView only (not all four views)
- The hook returns virtual items; render only those as `<tr>`s with `transform: translateY(...)` absolute positioning
- Reference: https://tanstack.com/table/latest/docs/framework/react/examples/virtualized-rows

**If the basket grows to >200 items frequently:**

- Convex sync of basket becomes worthwhile for cross-device continuity
- New table `extractionBaskets` with `userId + openalexId` compound PK
- Zustand stays as optimistic cache, mirrors to Convex on idle
- **Defer until user-tested** — don't over-engineer

**If Zotero API v4 / OAuth 2.0 ships:**

- Current code has `ZOTERO_REQUEST_TOKEN_URL`, `ZOTERO_ACCESS_TOKEN_URL`, `ZOTERO_AUTHORIZE_URL` as module-level constants — swap 3 URLs, replace HMAC-SHA1 signing with standard bearer token exchange
- The encryption-at-rest and audit logging layers stay the same
- **Monitor:** https://www.zotero.org/support/dev/web_api/v3/basics last-modified date and https://forums.zotero.org/categories/api

---

## Sources

### Verified HIGH confidence

- `@tanstack/react-table` v8.21.3 — via `npm view @tanstack/react-table version time.modified peerDependencies` (modified 2026-04-09, peerDeps `react >=16.8`)
- `@tanstack/react-virtual` v3.13.23 — via `npm view @tanstack/react-virtual version peerDependencies` (peerDeps explicitly list `^19.0.0`)
- `@tanstack/react-table` v9 alpha status — via `npm view @tanstack/react-table versions` (`9.0.0-alpha.32` is latest alpha)
- Zotero OAuth 1.0a status — [Zotero Web API v3 basics](https://www.zotero.org/support/dev/web_api/v3/basics) (doc last modified 2025-09-24; direct quote: "Zotero currently supports only OAuth 1.0a")
- Zotero rate limits (Backoff header + 429 + 100 items/page pagination) — same source
- Zotero endpoints (`/users/{id}/items`, `/groups/{id}/items`, `/users/{id}/collections/{key}/items`) — same source
- `zotero-api-client` v0.48.0 API-key-only scope — [zotero-api-client GitHub README](https://github.com/tnajdek/zotero-api-client) (via `npm view` + WebFetch)
- Existing code uses manual HMAC-SHA1 — verified via `Grep` on `convex/zotero/actions.ts` (confirmed `crypto.createHmac("sha1")`, `HMAC-SHA1`, `oauth_consumer_key`, `oauth_signature_method` constants)
- Existing `PLAN_CONFIG` shape — read `convex/lib/constants.ts` lines 27-32
- Existing `createSidebarStore` factory — read `lib/store.ts` lines 1070-1095
- Existing `resolveEffectivePlan` — read `lib/billing/entitlements.ts` lines 44-47
- `shadcn/ui` React 19 support — [shadcn/ui React 19 guide](https://ui.shadcn.com/docs/react-19)
- `shadcn/ui` data-table is a pattern not a component — [shadcn/ui data-table docs](https://ui.shadcn.com/docs/components/data-table)

### Verified MEDIUM confidence

- TanStack Table v9 timing ("challenge to ship in 2026") — Kevin Van Cott X post, Dec 2025 + [TanStack Table V9 Roadmap Discussion #5270](https://github.com/TanStack/table/discussions/5270)
- 1000 rows don't need virtualization — based on openstatus, sadmann7/tablecn, LogRocket guide all starting virtualization at 10,000+ rows
- openstatus / tablecn as production reference — [openstatus data-table](https://data-table.openstatus.dev/), [sadmann7/tablecn](https://github.com/sadmann7/tablecn)
- React Compiler + TanStack Table issue — [TanStack Table issue #5567](https://github.com/TanStack/table/issues/5567)
- `@vercel/flags` `4.0.6`, `@growthbook/growthbook` `1.6.5`, `unleash-client` `6.10.1` — via `npm view`
- `oauth-1.0a@2.2.6` last published 2019-06-05 — via `npm view oauth-1.0a time`

### LOW confidence (flagged)

- **TanStack Table v9 release date** — open question in 2026. Treat as "not ready" and stay on v8 until a beta ships.
- **Zotero's actual rate-limit numbers** — Zotero explicitly declines to publish. Implementation must respect `Backoff` and `429` headers rather than hardcode intervals.

---

## Gaps / Open Questions for Downstream Phases

1. **HighlightedCitationView verbatim slicing performance** — if 1000 results × average 3 paragraphs × 85% Levenshtein re-scan on every filter change, this needs benchmarking. **Flag for research in the workbench phase.**
2. **Basket dedup when OpenAlex ID is missing from Zotero items** — Zotero items have DOI, PMID, ISBN but not always an OpenAlex ID. Adapter needs a DOI→OpenAlex resolution step. Use existing `@sickrin/openalex-sdk@^1.0.0`. **Flag for research in the Zotero revival phase.**
3. **`Number.POSITIVE_INFINITY` vs large-finite for enterprise limit** — decide once during implementation. Convex validators don't accept `Infinity` in `v.number()`, so either (a) never serialize the limit through Convex (`getMaxExtractionPapers` is a pure server helper), or (b) use `10_000` as the enterprise ceiling.
4. **TierSelector → createExtractionJob wiring** (v6.0 gap EXTR-07 / `provider.order` missing) — not a stack choice, but must be addressed in the same milestone. No library needed.

---

*Stack research for: v7.0 Extraction Workbench (cross-source selection + results workbench + Zotero revival + 1000-paper limit)*
*Researched: 2026-04-15*
*Confidence: HIGH on library decisions, Zotero protocol, and existing-stack integration; LOW only on TanStack Table v9 release timing (which resolves to "not yet, stay on v8")*
