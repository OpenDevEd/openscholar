# Requirements: OpenAlex Count — v7.0 Extraction Workbench

**Defined:** 2026-04-15
**Core Value:** Reliable, well-tested academic search and AI extraction — every major code path has tests, and every new feature is built test-first.

## v7.0 Milestone Context

Restore the pre-v6.0 results workbench (table/card/split views with highlighted citations), build a unified cross-source paper selector (library + collections + search results + manual IDs + Zotero) that stages selections across multiple origins into one job via a persistent selection basket, enforce a 1000-paper per-job hard limit that's displayed at every selection point and structured for future per-tier enforcement, revive the orphaned Zotero OAuth flow from `convex/zotero/**` (~1433 LoC intact), and close the v6.0 integration gaps (UI-01 ExtractionDialog orphan, EXTR-01 TierSelector orphan, PARSE-07 parsingSource badge, CRASH-02 bare useQuery).

**This milestone is integration, not invention.** v6.0 shipped the backend; v7.0 wires it to a UX worthy of the data. The one new runtime dependency is `@tanstack/react-table@^8.21.3`; everything else reuses existing patterns (`createSidebarStore` factory, `motion/react` v12, existing Zotero OAuth 1.0a, existing `resolveEffectivePlan`).

## v7.0 Requirements

### Hard Paper Limit

- [ ] **LIM-01**: The system enforces a 1000-paper per-job hard limit via `MAX_EXTRACTION_PAPERS_PER_JOB` in `convex/lib/queryBounds.ts` (bumped from 200), with an independent `MAX_EXTRACTION_RESULTS_QUERY` for internal `.take()` bounds that preserves Convex's 8 MB result-size cap
- [ ] **LIM-02**: The per-job limit is stored in a per-tier-ready shape `EXTRACTION_LIMITS_BY_TIER: Record<SubscriptionPlan, number>` so adjusting free/pro/enterprise requires editing only one constant (no code changes in callers); all tiers resolve to 1000 in this milestone
- [ ] **LIM-03**: A new `getExtractionLimitForUser(ctx)` Convex helper reads the user's effective plan via existing `resolveEffectivePlan` and returns their per-job limit; a reactive `getExtractionLimit` query exposes it to the client
- [ ] **LIM-04**: User sees an always-visible "X / 1000 papers" counter with a progress bar that turns yellow at 80% of the limit and red at 100%, rendered in the basket drawer and on the `/extraction/new` selector page
- [ ] **LIM-05**: When the selection basket reaches the cap, all remaining "add" checkboxes in every source tab are disabled with an explanatory tooltip ("Basket full — remove N papers to continue")
- [ ] **LIM-06**: When a user bulk-pastes more OpenAlex IDs than the remaining capacity allows, the excess is silently dropped with a toast stating how many papers were dropped
- [ ] **LIM-07**: The backend `createExtractionJob` mutation hard-rejects over-limit submissions with a typed `EXTRACTION_LIMIT_EXCEEDED` error routed to a localized toast via `lib/toast/error-resolver.ts`

### Selection Basket & Cross-Source Picker

- [ ] **SEL-01**: User can access a unified paper selection page at `/extraction/new` with tabs for Library, Collections, Search Results, Manual IDs, and Zotero
- [ ] **SEL-02**: User can bulk-select papers from their library (via existing `app/library` data) and add them to the selection basket with a single action
- [ ] **SEL-03**: User can add papers from a specific collection to the basket in one click ("Extract entire collection") or filter-and-select within the collection, reusing existing v2.1 `collections` + `libraryItemCollections` schema
- [ ] **SEL-04**: User can bulk-select papers from search results at `app/results/[searchId]` and add them to the basket
- [ ] **SEL-05**: User can paste a list of OpenAlex IDs (one per line) and have them resolved and added to the basket via a new `convex/openalex/actions.ts:resolveManualIds` action
- [ ] **SEL-06**: User can add papers to the basket from a connected Zotero library (see ZOT-02)
- [ ] **SEL-07**: The selection basket persists across tab switches and client-side navigation within the same browser session via a Zustand store backed by `sessionStorage` (cleared only on successful job creation)
- [ ] **SEL-08**: The basket dedupes papers across sources using a `normalizeOpenAlexId` utility (handles `W123`, `https://openalex.org/W123`, `openalex:W123`) so the same paper added from two sources counts exactly once
- [ ] **SEL-09**: User can open a persistent basket drawer (shadcn `Sheet`) from anywhere in the app showing the total count, per-source breakdown, and a "Review & start extraction" CTA
- [ ] **SEL-10**: User can remove individual papers from the basket before submitting, and sees a visual "already in basket" indicator next to papers that are already staged when browsing any source tab
- [ ] **SEL-11**: User can click an `<AddToExtractionButton>` mounted in the existing library, search, and bookmarks command centers to add papers from that context without leaving the page
- [ ] **SEL-12**: A sidebar nav badge on the "Extraction" item displays the current basket count in real time, driven by the Zustand store

### Results Workbench

- [ ] **WB-01**: User can view extraction results in a table view where rows are papers and columns include title, authors, year, DOI, status, confidence, and one column per question, powered by `@tanstack/react-table@^8.21.3` (new dep) + re-added shadcn `<Table />` primitive
- [ ] **WB-02**: User can toggle column visibility in the table view; the preference persists across job navigations via a Zustand store keyed `extraction-results-view` (global user preference)
- [ ] **WB-03**: User can sort the table by any sortable column and filter by status, confidence, year, venue, and answer value via a shared toolbar hoisted above all views
- [ ] **WB-04**: User can run a full-text client-side search across paper titles, authors, and answers in the current job (debounced via React 19 `useDeferredValue` to avoid filter re-render storms)
- [ ] **WB-05**: User can switch to a card view where each paper is a self-contained card with inline answers; the card view is virtualized via `@tanstack/react-virtual@^3.13.23` (new dep scoped to card-view bundle) to keep Mobile Safari from crashing at 1000 rows
- [ ] **WB-06**: User can switch to a split view with a paginated paper list on the left and the selected paper's full answer detail on the right
- [ ] **WB-07**: User can click a citation in any view to open a highlighted evidence drawer that renders the verbatim `source.text.slice(evidence_start_char, evidence_end_char)` with a parsing-source badge — never the LLM's `evidence_quote` field
- [ ] **WB-08**: User can export the currently-filtered result subset as CSV, JSON, or XLSX, reusing the existing v6.0 export helpers
- [ ] **WB-09**: User can paginate the table/card/split views with "X–Y of Z papers" counts and see the pagination state reset correctly when filters change
- [ ] **WB-10**: The workbench toolbar reuses the v2.2 `FilterSection` primitive for consistent cross-page filter chrome

### Zotero Revival

- [ ] **ZOT-01**: User can connect their Zotero account via a "Connect Zotero" card on the `/settings` page that initiates the existing `convex/zotero/actions.ts:startOAuth` flow (OAuth 1.0a per Zotero's current API — they have not migrated to OAuth 2.0)
- [ ] **ZOT-02**: User can browse their Zotero library collections and items in a `<ZoteroTab>` within the `/extraction/new` paper selector and add items to the basket
- [ ] **ZOT-03**: When a user checks a Zotero item, the system lazily resolves its DOI to an OpenAlex ID via a new `convex/openalex/actions.ts:resolveByDoi` action with a per-item spinner, green-on-success / red-on-failure state
- [ ] **ZOT-04**: Zotero items without a resolvable DOI (books, grey literature, dissertations) are shown with a disabled checkbox and a tooltip explaining the limitation
- [ ] **ZOT-05**: The existing env-validation cron is extended to verify `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET`, and `ENCRYPTION_KEY` presence on every run, failing loudly if any are missing in Convex dashboard
- [ ] **ZOT-06**: A dev-guarded `purgeStaleZoteroState` internal action deletes all rows from `zoteroConnections` and `zoteroOAuthTokens` to clean up orphan state from pre-v7.0 debugging in the dev database

### TierSelector Wiring (v6.0 EXTR-01 closure)

- [ ] **TIER-01**: The client-side `TierSelector` value (auto/cheap/accurate) is sent to `createExtractionJob` and persisted as an optional `tier` field on the `extractionJobs` row — no migration required (new rows only)
- [ ] **TIER-02**: The workpool action reads `tier` from the job row and calls `createCascadeTiers(tier)` to filter the 3-tier OpenRouter cascade accordingly (`auto` = all 3 tiers; `accurate` = top tier only; `cheap` = bottom tier only)
- [ ] **TIER-03**: A unit test inspects the constructed OpenRouter request payload to verify tier selection filters the cascade as expected

### v6.0 Gap Closures

- [ ] **GAP-01**: The `parsingSource` badge (`pmc` / `arxiv` / `unpdf` / `gemini` / `abstract_only`) is rendered on every result card and in the evidence drawer across all 4 workbench views — closes v6.0 PARSE-07 partial
- [ ] **GAP-02**: `EvidenceQuote` and `JobMetricsPanel` components use `useProtectedQuery` instead of bare `useQuery` to prevent flash during Clerk auth transitions — closes v6.0 CRASH-02 partial
- [ ] **GAP-03**: An ESLint rule forbids literal `1000` or `200` in `components/extraction/**` and `app/extraction/**` to prevent per-tier-limit drift across the codebase
- [ ] **GAP-04**: Phase-98 pre-flight benchmark confirms that the `getExtractionResults` reactive query payload remains under 5 MB at 1000 papers × 7 questions with the new `MAX_EXTRACTION_RESULTS_QUERY` bound, or (if it does not) the query is migrated to paginated mode before the 200→1000 bump lands in production

## Future Requirements

Deferred to v7.1+ based on research open questions and explicit user scope-out.

### Workbench Extensions (v7.1)

- **WB-F01**: Bulk re-run — user can select N papers from a completed job and re-extract them (credit-gated mutation, requires OCC research on partial re-runs against existing workpool)
- **WB-F02**: "Insufficient evidence" filter chip — one-click to surface papers needing manual fallback
- **WB-F03**: Rich evidence drawer with surrounding 2-3 sentences via `evidenceContextBefore/After` schema addition (requires forward-only migration)
- **WB-F04**: Save basket as collection — reuse v2.1 collection CRUD
- **WB-F05**: Keyboard shortcuts (j/k navigation, / focus search, e export)

### Tier-Specific Paper Limits (v7.1+)

- **LIM-F01**: Differentiate per-tier limits (free=100, pro=1000, enterprise=unlimited) by editing the `EXTRACTION_LIMITS_BY_TIER` constant shape already shipped in v7.0
- **LIM-F02**: Comparative tier display showing "You have X remaining; Pro users get 1000" with upgrade CTA near the counter

### Quality & Review (from v6.0 audit)

- **QUAL-F01**: Human-review queue UI consumer for `getReviewQueue` / `updateReviewStatus` (v6.0 EVAL-06 backend exists)
- **QUAL-F02**: 7-day rolling quality-trend dashboard UI consumer for `getQualityTrend` (v6.0 EVAL-05 backend exists)

### Mobile Polish

- **MOB-F01**: Dedicated bottom-sheet drawer variant on mobile (Phase 105 ships full-screen `Sheet` as baseline)

## Out of Scope

Explicitly excluded from v7.0. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Insights dashboards (summary cards, stacked bar charts, confidence rings, disagreement lists, grouped-answer rows) | User explicitly scoped out in milestone command: "ignore the insights and templates and whatever nonsense" |
| Report templates / report builder | User explicitly scoped out; was part of the pre-v6.0 UI but not recovered |
| Human-review queue UI | Deferred to v7.1 (backend exists from v6.0 Phase 96) |
| Quality-trend dashboard UI | Deferred to v7.1 (backend exists from v6.0 Phase 96) |
| Full PDF viewer for citations | Architectural — v6.0 free-first parsing waterfall discards PDFs after text extraction; only 2 of 5 parsing sources are PDFs |
| Highlighted-citation as a top-level 4th view | Demoted to drawer pattern — not all parsing sources are PDFs, so top-level placement is misleading |
| Inline cell editing of AI answers | Breaks v6.0 "evidence = verbatim slice" invariant |
| Multi-step wizard selector (replaces persistent basket) | Breaks the persistent-basket pattern users expect from competing tools (Elicit, Rayyan, Covidence) |
| Infinite scroll on results table | Breaks pagination counter and back-button behavior |
| Silent truncation at the 1000-paper cap | Bad UX — user must always see what got dropped |
| Modal paywall mid-flow when approaching tier limits | Bad UX — tier display is inline only |
| Migration of existing v6.0 extraction jobs to the new `tier` field | No migration — new rows only; existing rows run `auto` tier via null-coalesce |
| `evidenceContextBefore/After` schema addition | Requires forward-only migration; deferred to v7.1 |
| TanStack Table v9 | Still alpha (2024), 2026 ship uncertain per TanStack lead dev |
| shadcn `data-table` block | Monolithic component fights the 4-view workbench which needs one `useReactTable(...)` instance shared across views |
| AG Grid Community | 500 KB bundle + enterprise skin that clashes with Tailwind v4 theme tokens |
| `@vercel/flags` / Unleash / GrowthBook for per-tier limits | Experimentation tools, not entitlement tools; overkill for a 4-key constant |
| `zotero-api-client` npm package | API-key auth only, no OAuth 1.0a implementation — cannot help with our existing OAuth code |
| Virtualization for the table view | Research confirms 1000 rows don't need virtualization (only card view does); defer `@tanstack/react-virtual` to Phase 103 card-view only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIM-01 | TBD | Pending |
| LIM-02 | TBD | Pending |
| LIM-03 | TBD | Pending |
| LIM-04 | TBD | Pending |
| LIM-05 | TBD | Pending |
| LIM-06 | TBD | Pending |
| LIM-07 | TBD | Pending |
| SEL-01 | TBD | Pending |
| SEL-02 | TBD | Pending |
| SEL-03 | TBD | Pending |
| SEL-04 | TBD | Pending |
| SEL-05 | TBD | Pending |
| SEL-06 | TBD | Pending |
| SEL-07 | TBD | Pending |
| SEL-08 | TBD | Pending |
| SEL-09 | TBD | Pending |
| SEL-10 | TBD | Pending |
| SEL-11 | TBD | Pending |
| SEL-12 | TBD | Pending |
| WB-01 | TBD | Pending |
| WB-02 | TBD | Pending |
| WB-03 | TBD | Pending |
| WB-04 | TBD | Pending |
| WB-05 | TBD | Pending |
| WB-06 | TBD | Pending |
| WB-07 | TBD | Pending |
| WB-08 | TBD | Pending |
| WB-09 | TBD | Pending |
| WB-10 | TBD | Pending |
| ZOT-01 | TBD | Pending |
| ZOT-02 | TBD | Pending |
| ZOT-03 | TBD | Pending |
| ZOT-04 | TBD | Pending |
| ZOT-05 | TBD | Pending |
| ZOT-06 | TBD | Pending |
| TIER-01 | TBD | Pending |
| TIER-02 | TBD | Pending |
| TIER-03 | TBD | Pending |
| GAP-01 | TBD | Pending |
| GAP-02 | TBD | Pending |
| GAP-03 | TBD | Pending |
| GAP-04 | TBD | Pending |
