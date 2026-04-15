# Project Research Summary — v7.0 Extraction Workbench

**Project:** openalex-count (OpenScholar)
**Domain:** Next.js 15 + Convex literature-screening SaaS — results workbench + cross-source paper selector + Zotero revival + TierSelector wiring + per-tier-ready paper cap
**Researched:** 2026-04-15
**Confidence:** HIGH

## Executive Summary

v7.0 is not greenfield — it **wires up three orphans from v6.0** (the empty `ExtractionDialog.papers` path, the discarded `TierSelector` value, and the intact-but-disconnected `convex/zotero/**` backend) and **layers a selection-basket + multi-view workbench on top of existing extraction tables**. The mature prior art is Elicit (1,000-paper benchmark), Covidence (2025 click-to-PDF pattern), and Rayyan (August 2025 extraction form builder). All three converge on one canonical pattern: **tab-per-source dialog + persistent selection basket + sticky "X / limit" counter**, with inline cap communication (never mid-flow paywalls) and column-customisable data tables.

The recommended stack is deliberately minimal: **one new runtime dependency** (`@tanstack/react-table@^8.21.3`) plus re-adding the shadcn `<Table />` primitive. Everything else reuses what is already in the codebase — Zustand (existing `createSidebarStore` factory), `motion/react` v12 for the drawer (already installed), the existing Zotero OAuth 1.0a backend (verified against Zotero's 2025-09-24 docs — they have not migrated to OAuth 2.0), and the existing `resolveEffectivePlan` helper for tier lookups. The shadcn `data-table` block is **explicitly rejected** because it's monolithic and fights a four-view workbench that needs one `useReactTable(...)` instance shared across views.

Primary risks are all **integration hazards**, not novel engineering. The `MAX_EXTRACTION_PAPERS_PER_JOB` bump from 200 → 1000 cascades into 15 call sites (some with `MAX * 10` multipliers that will blow query-size limits at the new scale); OpenAlex IDs come in three non-normalised formats creating dedupe race conditions; card view at 1,000 items will crash Mobile Safari without virtualization; dev-DB Zotero connections are stale and must be purged before revival; and `tier` wiring requires threading through 5 edit sites. The TierSelector fix itself is **~5 edits, no migration** — the smallest feature in the milestone.

## Key Findings

### Recommended Stack (net new runtime deps: 1)

- **`@tanstack/react-table@^8.21.3`** (NEW, released 2026-04-09): headless engine for sort/filter/column-visibility/pagination/selection. Peer-deps verified compatible with `react@^19.2.4`. Reject shadcn `data-table` block (monolithic), AG Grid (500 KB + enterprise skin), react-data-grid (4-year beta), TanStack v9 (alpha).
- **shadcn `<Table />` primitive** (RE-ADDED via `npx shadcn@latest add table`): previously deleted in v6.0 scorched-earth.
- **Zustand** (EXISTING, v5.0.5): new `createSelectionBasketStore` factory matching the existing `createSidebarStore` conventions — `persist`, `version`, `_hasHydrated`, `partialize`.
- **sessionStorage** (not localStorage): basket lives for the tab session only. Prevents stale-basket credit burn; matches "workflow state, not user data" semantics.
- **`motion/react` v12** (EXISTING, v12.23.12): drag/spring/`AnimatePresence` built in — no need for `@use-gesture/react`.
- **Zotero OAuth 1.0a** (EXISTING, intact): 1,124 LoC at `convex/zotero/actions.ts` is orphaned but correct. Reject `zotero-api-client` (API-key auth only).
- **`@sickrin/openalex-sdk@^1.0.0`** (EXISTING): used by new `resolveByDoi` / `resolveManualIds` Convex actions.
- **`EXTRACTION_LIMITS_BY_TIER: Record<SubscriptionPlan, number>`** (EXTENSION of `convex/lib/queryBounds.ts`): per-tier-ready shape, same value (1,000) for all tiers in v7.0. Reject `@vercel/flags`, Unleash, GrowthBook.
- **`@tanstack/react-virtual@^3.13.23`** (DEFERRED for table view, REQUIRED for card view — see cross-cutting tension below).

### Feature Table Stakes

**Must have (P1, ship in v7.0):**
- **Results Workbench:** Paper × Question table (TanStack Table), column visibility, per-cell confidence dot + tooltip, filter bar (status / confidence / year / venue / answer-value), client-side full-text search, pagination with counts, card view, evidence quote on demand, export subset (filter-aware).
- **Cross-Source Picker:** Tabs for Library · Collections · Search · Manual IDs · Zotero in one unified page, persistent Zustand basket surviving tab switches, sticky "N / 1,000" counter, dedupe by normalised OpenAlex ID, select-all on current tab, visual indicator when paper already in basket.
- **1,000-Paper Limit UX:** Always-visible "X / 1,000" counter + progress bar, 80% yellow warning, 100% red hard reject, disabled checkboxes at cap, "Remove N papers to continue" message, batch-paste truncation with dropped-count toast, server-side hard reject at mutation time.
- **Per-Tier Display:** Inline tier badge near counter, subtle upgrade link when approaching limit, always show the cap.
- **Evidence Display:** Verbatim quote inline, **parsing-source badge** (closes v6.0 PARSE-07), "insufficient evidence" distinct visual state, copy-quote button, external DOI/OpenAlex link.
- **v6.0 Gap Closers:** Wire `ExtractionDialog.papers` from basket (UI-01), send `tier` to `createCascadeTiers(tier)` (EXTR-01), render `parsingSource` on all result views (PARSE-07), fix `EvidenceQuote`/`JobMetricsPanel` bare `useQuery` (CRASH-02).
- **Zotero Revival:** Settings "Connect Zotero" card, OAuth callback routing, Zotero tab in selector, DOI → OpenAlex resolution per-item spinner, items without DOI shown disabled.

**Should have (P2 differentiators, v7.0 if time permits):**
- **Split view** — table + resizable detail drawer. **No reviewed competitor has this.**
- **Bulk re-run** — select N papers → re-extract mutation. Credit-gated.
- **"Insufficient evidence" filter chip.**
- **Save basket as collection** — reuses v2.1 CRUD.

**Defer (v7.1+):** `evidenceContextBefore/After` schema addition (needs forward-only migration), comparative tier display, save-and-resume drafted jobs, full PDF viewer.

**Rejected anti-features:**
- Highlighted-citation as a top-level 4th view (OpenScholar discards PDFs; 3 of 5 parsing sources aren't PDFs) — demote to drawer.
- Inline cell editing of AI answers (breaks v6.0 "evidence = verbatim slice" invariant).
- Multi-step wizard selector (breaks persistent basket).
- Infinite scroll on results table (breaks pagination counter + back button).
- Silent truncation at 1,000 cap.
- Modal paywall mid-flow.

### Architecture Approach

Six load-bearing decisions on top of existing infrastructure: ephemeral Zustand basket (sessionStorage), Sheet drawer + dedicated `/extraction/new` page, single `<AddToExtractionButton>` at each command center, lazy DOI→OpenAlex resolution inside Zotero tab, static `EXTRACTION_LIMITS_BY_TIER` record in `queryBounds.ts`, and a 5-edit TierSelector wiring. The basket is **snapshot-based** (not reference-based) — stores own copies of `{openalexId, title, doi}` so it survives source deletion in another tab.

**Major components:**
1. **`useExtractionBasketStore`** — Zustand + `sessionStorage` + `_hasHydrated`, dedupes on normalised ID.
2. **`<ExtractionBasketDrawer>`** — shadcn `Sheet`, shows count + per-source breakdown + "Review & start extraction" CTA.
3. **`<AddToExtractionButton>` + `useAddToBasket` hook** — mounted at library/search/bookmarks command centers.
4. **`/extraction/new` page** — `SelectorTabs` (Library / Collections / Search / Manual / Zotero), ends in existing `ExtractionDialog` with `papers={basketArray}` finally populated.
5. **`<ExtractionWorkbench>` shell + 4 views** — table/card/split/highlight sharing one `useReactTable(...)` instance.
6. **`resolveByDoi` / `resolveManualIds` Convex actions** — 10 s `AbortSignal.timeout`, returns per-input `{input, resolved}`.
7. **`getExtractionLimitForUser` + `getExtractionLimit` query** — reads user's effective plan.
8. **5-edit TierSelector wiring** — optional `tier` schema field (no migration), `tier` arg on `createExtractionJob`, workpool reads tier from row, `createCascadeTiers(tier)` filters the cascade array, client sends `tier` in `createJob()`.
9. **`<ZoteroIntegrationCard>` + `<ZoteroTab>`** — reconnects the 1,433 LoC orphaned backend.

## Cross-Cutting Decisions (confirmed across multiple research files)

| Decision | STACK | FEATURES | ARCHITECTURE | PITFALLS |
|---|---|---|---|---|
| **TanStack Table v8.21.3 + raw shadcn `<Table />` primitives (reject shadcn data-table block)** | Adopt, peer-deps OK | Drop-in for paper × question matrix | Shared `useReactTable(...)` across 4 views | Filter re-render storm if `columns` not hoisted |
| **Zustand `createSelectionBasketStore` factory mirroring `createSidebarStore`** | Factory pattern | Persistent selection across tab switches | Ephemeral, sessionStorage-backed | Navigation loss if not persisted |
| **sessionStorage (not localStorage) for basket** | Tab-scoped | Session-long workflow | 1h soft expiry | Prevents stale-basket credit burn |
| **1,000-paper cap (Elicit benchmark)** | Record keyed by plan | Elicit direct benchmark | Static record in `queryBounds.ts` | 15 call-site cascade from 200 |
| **`EXTRACTION_LIMITS_BY_TIER` shape per-tier-ready, same value now** | Record<SubscriptionPlan, number> | Same v7.0, per-tier v7.1+ | `getExtractionLimitForUser` routes through it | Never hardcode literal `1000` — lint enforce |
| **Zotero stays on OAuth 1.0a; 1,124 LoC backend intact** | Verified vs 2025-09-24 docs | Category 2 Zotero tab consumes | Settings card + tab only new; backend untouched | Stale dev DB must be purged first |
| **`resolveByDoi` / `resolveManualIds` new Convex actions** | — | Needed for Zotero + manual tabs | New `convex/openalex/actions.ts` | Lazy resolution only on check |
| **Snapshot-based basket** | — | Basket unaffected by source mutation | Stores own copies | Multi-tab sessions don't invalidate |
| **Dedicated `/extraction/new` page + Sheet drawer** | — | Tabs + persistent basket, not wizard | Drawer for peek, page for assemble | — |

## Conflicts / Tensions Between Research Files (resolved)

| Tension | **Resolution** |
|---|---|
| **Does 1,000 rows need virtualization?** | **Table view does NOT virtualize. Card view MUST.** Phase 103 ships card view with `@tanstack/react-virtual@^3.13.23` — lazy bundle. |
| **localStorage vs sessionStorage vs URL for basket** | **sessionStorage wins.** Clear only on successful job creation. |
| **Where does column visibility live?** | **Split state:** global UX prefs (column visibility, view mode) → Zustand+localStorage via factory; view-specific (selected paper, active filter, search) → URL via nuqs. |
| **Highlighted-citation view: top-level view or drawer?** | **Demote from 4th view to drawer.** 4 views = table / card / split / highlight where "highlight" = in-context text reveal (not PDF). |
| **Ship `evidenceContextBefore/After` schema addition in v7.0?** | **Defer to v7.1.** Phase 103 drawer = verbatim quote + parsing-source badge only. |
| **5 vs 10 phases** | **7 phases** — aggregates ARCHITECTURE 0-9 by surface-area and risk. |
| **Basket entry shape key name** | **Use `sourceMetadata`.** |

## Top 8 Critical Pitfalls

1. **200 → 1,000 bump cascades to 15 call sites** (CRITICAL, Phase 98) — `getExtractionResults` uses `MAX * 10` multipliers that will blow Convex's 8 MB result-size cap at 1k papers × 7 questions. **Prevention:** benchmark 1k-paper job end-to-end BEFORE bumping. Split `MAX_EXTRACTION_PAPERS_PER_JOB` (user cap) from `MAX_EXTRACTION_RESULTS_QUERY` (internal bound).

2. **Card view scroll perf at 1,000 cards** (CRITICAL, Phase 103) — naively mapped = 500+ MB heap, Mobile Safari crash. **Prevention:** card view MUST use `@tanstack/react-virtual` + `React.memo` + lazy evidence quote.

3. **Dedupe race on mixed-format OpenAlex IDs** (CRITICAL, Phase 99) — `W123` vs `https://openalex.org/W123` vs `openalex:W123`. **Prevention:** `normalizeOpenAlexId(id)` utility; dedupe basket by normalised key.

4. **TanStack Table column-filter re-render storm** (CRITICAL, Phase 103) — 1k rows + debounced text filter → every keystroke recomputes if `columnFilters` identity changes. **Prevention:** hoist `columns` definition outside component, `React.memo` row cells, React 19 `useDeferredValue`, never recompute `useReactTable` options inline. **Never add filter args to the primary reactive `getExtractionResults` query.**

5. **Basket state lost on navigation** (CRITICAL, Phase 99) — default Zustand is in-memory. **Prevention:** `persist` middleware + `sessionStorage` adapter. Clear only on successful job creation.

6. **Stale `zoteroConnections` + `ENCRYPTION_KEY` drift in dev DB** (CRITICAL, Phase 104) — pre-revival dev DB has orphan rows encrypted with rotated keys. **Prevention:** ship `purgeStaleZoteroState` internal action (dev-guarded). Verify env vars via `npx convex env list` (NOT `.env.local`).

7. **Silent cap overflow across sources** (CRITICAL, Phases 99 + 102) — per-source counters showing `800/1000` and `300/1000` while basket aggregate is 1,100 → rejection at submit. **Prevention:** single source of truth is the basket store; every picker reads `useBasketStore(s => s.count)` and displays global `X / 1000`.

8. **Zotero items with no OpenAlex-resolvable ID** (SIGNIFICANT, Phase 104) — books, grey literature, dissertations have no DOI. **Prevention:** lazy `resolveByDoi` on checkbox tick with inline spinner. Items with no DOI get disabled checkbox + tooltip.

## Proposed 7-Phase Structure (roadmapper input)

### Phase 98: Pre-flight & Hard-Limit Foundation
- **Delivers:** `EXTRACTION_LIMITS_BY_TIER` record, `getExtractionLimitForUser` helper, benchmark of 1k-paper job, split `MAX_EXTRACTION_PAPERS_PER_JOB` from `MAX_EXTRACTION_RESULTS_QUERY`, env var verification, re-install `components/ui/table.tsx`.
- **Avoids:** PITFALLS 1 (call-site cascade), 6 (env drift).
- **Research-flag:** MEDIUM.

### Phase 99: Basket Core (parallel with 100 & 101)
- **Delivers:** `lib/store/extraction-basket-store.ts`, `lib/hooks/use-add-to-basket.ts`, `<ExtractionBasketDrawer>`, `normalizeOpenAlexId` utility.
- **Avoids:** PITFALLS 3 (dedupe race), 5 (navigation loss), 7 (silent cap overflow).
- **Research-flag:** LOW.

### Phase 100: Backend Wiring & TierSelector Fix (parallel with 99 & 101)
- **Delivers:** `convex/openalex/actions.ts` with `resolveByDoi` + `resolveManualIds`, `convex/lib/extractionLimit.ts`, optional `tier` field on `extractionJobs`, `tier` arg on `createExtractionJob`, workpool reads `tier` from row, `createCascadeTiers(tier)`, `getExtractionLimit` reactive query.
- **Closes:** v6.0 EXTR-01 (TierSelector orphan).
- **Research-flag:** LOW.

### Phase 101: Workbench Primitives (parallel with 99 & 100)
- **Delivers:** Shared `DataTable` wrapper, filter toolbar primitive, view switcher primitive, column visibility persistence via `createSidebarStore` factory.
- **Avoids:** PITFALLS 4 (filter re-render storm).
- **Research-flag:** MEDIUM — TanStack v8 memoization spike.

### Phase 102: Entry Points & Sidebar Badge
- **Delivers:** `<AddToExtractionButton>`, mounts at library/search/bookmarks command centers, collection-flow variant, sidebar nav badge, i18n keys seeded in all 6 locales up front.
- **Research-flag:** LOW.

### Phase 103: Workbench Views + Selector Page (two sub-plans, parallel)
- **Sub-plan A — Workbench Views:** `<ExtractionWorkbench>` shell, 4 views (table/card/split/highlight), card view virtualized with `@tanstack/react-virtual`, `parsingSource` badge on all views.
- **Sub-plan B — Selector Page:** `app/extraction/new/page.tsx`, `SelectorTabs` (Library / Collections / Search / Manual, Zotero deferred to 104), `ExtractionDialog` populated from basket, sticky "X / 1,000" counter.
- **Closes:** v6.0 UI-01, PARSE-07, CRASH-02.
- **Avoids:** PITFALLS 2 (card scroll perf), 4 (filter storm).
- **Research-flag:** HIGH for sub-plan A (card virtualization).

### Phase 104: Zotero Revival
- **Delivers:** `purgeStaleZoteroState` dev-guarded action, `<ZoteroIntegrationCard>`, `<ZoteroTab>`, DOI → OpenAlex resolution, OAuth callback route alignment, `fetchWithBackoff` helper, Zotero i18n keys.
- **Avoids:** PITFALLS 6 (stale dev DB), 8 (items without DOI).
- **Research-flag:** MEDIUM — re-verify Zotero 2025 rate-limit docs.

### Phase 105: Polish, Integration, E2E
- **Delivers:** E2E Playwright flow, mobile responsive drawer, reduced-motion support, i18n audit, ESLint rule forbidding literal `1000` in `components/extraction/**`, closing CRASH-02 in `EvidenceQuote` + `JobMetricsPanel`.
- **Closes:** all remaining v6.0 gaps.
- **Research-flag:** LOW.

### Phase ordering rationale

- **Phase 98 first:** bumping the constant without benchmarking first is the single highest-risk change.
- **Phases 99/100/101 parallelise:** disjoint files (Zustand store / convex actions / UI primitives).
- **Entry points (102) after basket (99) but before selector page (103).**
- **Views + selector (103) parallelise as sub-plans.**
- **Zotero (104) last before polish:** quarantined, riskiest debugging.
- **Polish (105) separate.**
- **Critical path:** `98 → 99 → 100 → 102 → 103 → 104 → 105`. Workbench primitives (101) run independently.

## Open Questions (for requirements-definition or phase-research)

1. **Phase 98 benchmark outcome determines Phase 100 scope.** If 1k-paper payload > 5 MB, Phase 100 must include pagination migration of `getExtractionResults`.
2. **Card view virtualization approach** — `@tanstack/react-virtual` vs `react-window`? Decide in Phase 103 research pass.
3. **"Select all matching filter" at 10k × 1k cap** — confirm-dialog vs inline truncation toast? Phase 103 selection-semantics spike.
4. **Zotero callback URL strategy** — two apps (dev + prod) or one app with multiple registered callbacks?
5. **Evidence drawer richness for v7.0** — verbatim quote only or also surrounding 2-3 sentences via schema addition? Recommendation: MVP only.
6. **Save basket as collection** — v7.0 or v7.1?
7. **Bulk re-run credit-gated mutation** — v7.0 or v7.1? Requires OCC research on partial re-runs.
8. **Column visibility default state per view** — which columns hidden by default in table vs card vs split?
9. **Mobile behaviour of the drawer** — full-screen Sheet vs bottom-sheet?
10. **i18n key namespace naming** — `extraction.workbench.*` vs flat `extraction.*`?

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | TanStack Table v8.21.3 peer-deps verified; Zotero OAuth 1.0a confirmed current; Motion v12 drag/spring verified. |
| Features | **MEDIUM-HIGH** | Elicit 1,000-paper cap primary source; Covidence/Rayyan 2025 patterns primary; anti-feature calls from NN/G, PatternFly, Smashing. |
| Architecture | **HIGH** | Entirely grounded in repo analysis with exact line numbers and LoC counts. 5-edit TierSelector fix spelled out with exact code. |
| Pitfalls | **HIGH** for repo-grounded hazards; **MEDIUM** for generic React/library patterns. |

**Overall confidence:** **HIGH.** Riskiest integration hazards are repo-verified; riskiest library decisions are peer-dep verified; riskiest external dependencies are documentation-current.

## Sources

**Primary (HIGH confidence):**
- `@tanstack/react-table@8.21.3` peer-deps verified vs `react@^19.2.4`. <https://tanstack.com/table/v8/docs>
- Zotero Web API v3 Basics, last modified 2025-09-24. <https://www.zotero.org/support/dev/web_api/v3/basics>
- Elicit 1,000-paper systematic review cap. <https://support.elicit.com/en/articles/7927169>
- Covidence 2025 click-to-PDF extraction. <https://changes.covidence.org/>
- Rayyan August 2025 data extraction form builder. <https://blog.rayyan.ai/2025/08/11/data-extraction-in-rayyan/>
- Direct repository analysis — file paths, LoC counts, line numbers, orphan state grounded in live `convex/**`, `components/**`, `app/**`, `.planning/**` inspection.

**Secondary (MEDIUM confidence):**
- openstatus/data-table reference. <https://github.com/openstatusHQ/data-table-filters>
- sadmann7/tablecn. <https://github.com/sadmann7/shadcn-table>
- PatternFly Bulk Selection Pattern. <https://www.patternfly.org/patterns/bulk-selection/>
- NN/G Bulk Actions Design Guidelines. <https://www.nngroup.com/videos/bulk-actions-design-guidelines/>

**Rejected alternatives:**
- TanStack Table v9 alpha, AG Grid Community (500 KB), react-data-grid (4-year beta), zotero-api-client v0.48.0 (no OAuth), feature-flag libraries (overkill), shadcn `data-table` block (monolithic), wizard selector pattern.
