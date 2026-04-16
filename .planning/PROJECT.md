# OpenAlex Count — Academic Search & Extraction Platform

## What This Is

OpenAlex Count is an academic literature search and extraction tool built with Next.js + Convex. It provides AI-powered screening, translation, and data extraction across academic papers sourced from OpenAlex. The platform includes Stripe-integrated billing with subscription tiers (free, go, pro, enterprise), credit-based usage metering, a comprehensive test suite (1072+ tests across 90+ files), a persistent library with collections, advanced filtering, a polished two-column sidebar layout shared across search and library pages, bulk screening that processes up to 200 search results in background with user-defined scoring rules and auto-rating, screening result export (CSV/JSON/XLSX) with dynamic question columns and scoring metadata, simplified minScore-only star thresholds with highest-match-wins logic, overhauled extraction insights with color-coded summary cards, contextual confidence badge, Recharts stacked bar visualization (lazy-loaded), question status dots with progress bars, and answer semantic grouping with expandable drill-down, and a production-hardened codebase with zero `as any` casts, XSS-safe rendering, persistent audit logging, incremental report aggregation, dynamic XLSX export, env var validation, automated cleanup crons, internal-only debug endpoints, denormalized O(1) library counting, and bounded queries with shared MAX constants.

## Core Value

Reliable, well-tested academic search and AI extraction — every major code path has tests, and every new feature is built test-first.

## Current Milestone: v7.0 Extraction Workbench

**Goal:** Restore the pre-v6.0 results workbench (table/card/split views with highlighted citations), build a unified cross-source paper selector (library + collections + search results + manual IDs + Zotero) that stages selections across multiple origins into one job, and enforce a 1000-paper per-job hard limit that's displayed at every selection point and structured for future per-tier enforcement.

**Target features:**

- **Results workbench** — Four complementary views (table, card, split, highlighted-citation) on `/extraction/[jobId]` with shared toolbar (view switcher, status/confidence filters, search, column picker, pagination), backed by the existing v6.0 `extractionResults` table
- **Universal cross-source paper selector** — Multi-source picker with a selection basket ("cart" pattern) that stages papers from library, collections, search results, manual OpenAlex IDs, and Zotero into a single job, deduped by OpenAlex ID
- **Zotero OAuth revival** — Re-activate the orphaned `convex/zotero/**` OAuth flow (~1433 LOC) via a settings connection card + a Zotero source tab in the picker
- **Hard paper limit (200 → 1000)** — Bump `MAX_EXTRACTION_PAPERS_PER_JOB`, live "X / 1000" counters in dialog and every source picker, backend hard reject with toast-routed error, constant shape made per-tier-ready (no tier logic yet)
- **TierSelector wiring** — Send the v6.0 `TierSelector` UI value to `createExtractionJob` (currently orphaned, cascade always runs all 3 tiers)

**Explicitly out of scope:** insights dashboards (summary cards, stacked bar charts, confidence rings), report templates / report builder, human-review queue, quality-trend dashboard — deferred to future milestones.

## Requirements

### Validated

- ✓ Stripe webhook endpoint receives events at `convex/http.ts` — existing
- ✓ Subscription creation flow exists — existing
- ✓ Credit purchasing with predefined bundles — existing
- ✓ Monthly credit grants on `invoice.paid` — existing
- ✓ Subscription sync on lifecycle events — existing
- ✓ Stripe event log for idempotency (`stripeEventLogs` table) — existing
- ✓ Cron-based subscription status checks and invoice reconciliation — existing
- ✓ Customer portal integration — existing
- ✓ Upgrade flow charges proration difference immediately via `always_invoice` — v1.0
- ✓ Downgrade takes effect at end of billing period via subscription schedule — v1.0
- ✓ Credit purchase flow correct end-to-end with reactive UI updates — v1.0
- ✓ Webhook handlers re-fetch from Stripe API (out-of-order event protection) — v1.0
- ✓ Cancellation updates in-place preserving stripeSubscriptionId — v1.0
- ✓ Payment failure handling with 7-day grace period and auto-downgrade — v1.0
- ✓ All webhook handlers idempotent with documented contracts — v1.0
- ✓ Reconciliation cron paginates and has safety cap (500 invoices) — v1.0
- ✓ Reliable upgrade flow with pinned proration_date, tri-state toast, and dual-path credit grants — v1.1
- ✓ Proration preview dialog with line item breakdown and payment method display — v1.1
- ✓ Pro-rata credit grants on mid-cycle upgrades (action + webhook backup path) — v1.1
- ✓ Upgrade error handling: processing toast on grant failure, webhook recovery, dismiss guard — v1.1
- ✓ E2E billing test infrastructure with Playwright, Clerk isolation, and Stripe bypass — v1.2
- ✓ 11 billing E2E tests covering subscribe, upgrade, downgrade, cancel, credits — v1.2
- ✓ CI pipeline integration for billing E2E across 3 jobs — v1.2
- ✓ Multi-environment Vitest config (node, edge-runtime, jsdom) with zero-regression — v2.0
- ✓ AI prompt builder structural tests and Zod schema contract tests — v2.0
- ✓ AI batch processing fail-soft tests (all-success, all-fail, partial-failure) — v2.0
- ✓ AI cost calculation and model registry tests across 4 providers — v2.0
- ✓ Search param construction, region codec bijectivity, and filter builder tests — v2.0
- ✓ CSV/JSON export, citation helper, and download output tests — v2.0
- ✓ Auth state machine, user creation atomicity, and profile sync guard tests — v2.0
- ✓ Plan config, tier enforcement, feature flag, and subscription selection tests — v2.0
- ✓ Rating saves/upserts to Convex library with slim 10-field metadata — v2.1
- ✓ Dedicated /library page with search, filter, sort, pagination, auth gate — v2.1
- ✓ Collection CRUD with junction table many-to-many and cascade delete — v2.1
- ✓ Advanced filtering (date saved, year range, collection) with URL state via nuqs — v2.1
- ✓ CSV/JSON export with filter-aware subset export — v2.1
- ✓ Mobile responsive library with 6-locale i18n and toast feedback — v2.1
- ✓ SidebarLayout + FilterSidebar reusable primitives with Zustand store factory and i18n — v2.2
- ✓ Search page refactored to SidebarLayout + SearchFilterSidebar composition — v2.2
- ✓ Library page two-column sidebar layout with 5-filter sidebar (rating, date, year, collection, search) — v2.2
- ✓ Sort controls (date saved, year, rating, title) with search-aware disabling — v2.2
- ✓ Pagination with result counts and prev/next navigation — v2.2
- ✓ List/grid view toggle and rating stars on library items — v2.2
- ✓ DRY architecture: search and library pages share SidebarLayout, FilterSidebar, FilterSection — v2.2
- ✓ Debug console.log and @ts-ignore artifacts removed from production code — v2.3
- ✓ All `ctx: any`, `internal as any`, `components as any` replaced with proper Convex types — v2.3
- ✓ Zotero API keys encrypted at rest with AES-256-GCM via shared crypto module — v2.3
- ✓ Extraction cascade deletion covers all 8 child tables with scheduler-based batching — v2.3
- ✓ N+1 extraction queries parallelized, unbounded .collect() calls bounded — v2.3
- ✓ Token-bucket rate limits enforced on all 6 exposed endpoints — v2.3
- ✓ Integration tests for cascade delete, Zustand migrations, and extraction insight edge cases — v2.3
- ✓ Plaintext Zotero apiKey migrated to encryptedApiKey and deprecated field removed from schema — v2.4
- ✓ cancelExtraction stops workflow and workpool processing with credit-guard protection — v2.4
- ✓ Orphan extractionRunDiffs cleaned up on baseline job deletion (Step 8b cascade) — v2.4
- ✓ Diff truncation surfaced with isTruncated/totalChanges metadata and i18n UI banner — v2.4
- ✓ GDPR cleanupDeletedUsers extended to cascade-delete extraction jobs and Zotero connections — v2.4
- ✓ 18 shared extraction validators replacing v.any() in all 11 query return types — v2.4
- ✓ Typed migrateSearchHistoryState and attachReviewMetadata with proper interfaces — v2.4
- ✓ getJobDetails returns all papers (removed .take(100) cap) — v2.4
- ✓ Debug endpoint production policy documented with JSDoc annotations across 17 functions — v2.4
- ✓ Orphaned /test-sidebar page removed from production build — v2.4
- ✓ OpenAlex User-Agent uses configurable OPENALEX_CONTACT_EMAIL env var — v2.4
- ✓ Hourly cron cleanup of expired Zotero OAuth tokens — v2.4
- ✓ Stripe webhook handlers use typed SDK event objects with zero `as any` casts — v2.5
- ✓ `getPlanFromPriceId` substring fallback removed; unknown prices return "free" with warning — v2.5
- ✓ Pending plan change state stored in Convex `subscriptions` table instead of Stripe metadata — v2.5
- ✓ Extraction job page uses typed `Id<"extractionJobs">` with zero `as any` casts — v2.5
- ✓ Typed pagination validator and searchFilters validator replacing all `v.any()` — v2.5
- ✓ `encryptedApiKey` required in schema (not optional) after completed migration — v2.5
- ✓ Library queries use proper empty pagination cursor pattern (no `"" as any`) — v2.5
- ✓ Centralized `decryptApiKey` utility with structured audit logging — v2.5
- ✓ Debug gate strengthened with audit logging on every invocation — v2.5
- ✓ N+1 review loading fixed with batch query, all `.collect()` calls bounded — v2.5
- ✓ `by_expiry` and `by_status_updatedAt` composite indexes added — v2.5
- ✓ Crypto module uses standard import with `"use node"` directive — v2.5
- ✓ Unused dependencies removed (ollama, unpdf, 20 Radix packages), pdfjs-dist made explicit — v2.5
- ✓ focus-mode.tsx decomposed into 3 sub-components — v2.5
- ✓ Stripe webhook, credit deduction, cascade deletion, and debug gate test coverage — v2.5
- ✓ Zero TypeScript compile errors across entire codebase (production + tests) — v2.5
- ✓ All `as any` casts eliminated from production code — ExtractionResultWithReview derived from validator, branded WorkflowId, v.union for rate limiter, typeof narrowing for Stripe customer — v3.0
- ✓ XSS-safe HighlightedText component replacing all dangerouslySetInnerHTML — v3.0
- ✓ Persistent auditLogs table with writeAuditLog internalMutation for security-sensitive operations — v3.0
- ✓ Env var validation cron checking all critical env vars every 24h — v3.0
- ✓ assertPlanPriceConfig fail-fast in all billing-critical handlers — v3.0
- ✓ Debug function production exclusion strategy documented — v3.0
- ✓ Incremental extraction report aggregation via extractionJobStats table with lazy backfill — v3.0
- ✓ ExcelJS migration with dynamic import (~500KB bundle savings) — v3.0
- ✓ Bounded getLibraryCount query (.take(10_000)) — v3.0
- ✓ Subscription cron batching with 45s circuit-breaker and self-scheduling continuation — v3.0
- ✓ Migration helpers removed (listAllConnections, migrateToEncryptedKeys) — v3.0
- ✓ OpenAlex contact email fail-loud validation — v3.0
- ✓ Credit deduction OCC concurrency validated (Convex prevents negative balances) — v3.0
- ✓ Module boundary fix: getProviderModel moved to lib/ai/server/ — v3.0
- ✓ Dead code removed: library-filters.tsx, test.setup.ts, highlightText function — v3.0
- ✓ 45+ new tests: concurrency, XSS, GROBID fallback, env validation, ExcelJS round-trip, subscription cron — v3.0
- ✓ All 9 v.any() validators replaced with typed alternatives (JSON serialization for Clerk webhooks) — v3.1
- ✓ Extraction and billing backends fully typed (workflow, workpoolActions, mutations, subscriptions, credits, stripeWebhookHandlers) — v3.1
- ✓ Client libraries and React components fully typed (utils, store, auth, extraction, AI, results-list, paper-card, extraction components) — v3.1
- ✓ Typed mock factory infrastructure (DeepPartial factories for Convex context, Ids/documents, Stripe events) — v3.1
- ✓ All 20+ test files typed using mock factories (85+ `as any` casts eliminated) — v3.1
- ✓ Zero-any verified: `tsc --noEmit` zero errors, `verify-no-any.sh` passes all 3 checks (`: any`/`as any`/`any[]`, `<any>` angle-bracket, tsc compilation) — v3.1
- ✓ Debug endpoints converted to internal functions — platform-enforced unreachability, debug_gate.ts deleted — v3.2
- ✓ O(1) library count via denormalized libraryItemCount with atomic counter in all mutation paths — v3.2
- ✓ All high-traffic .collect() calls bounded with .take(N) guards and shared MAX constants — v3.2
- ✓ Cascade delete paths verified safe from over-bounding — v3.2
- ✓ ~40 naturally-bounded queries annotated with cardinality comments — v3.2
- ✓ Bulk screening job processing up to 200 papers in background via Convex workflow+workpool — v4.0
- ✓ User-defined scoring rules per screening question with per-answer point values (yes/no/null → +/- points) — v4.0
- ✓ Score-to-star rating threshold mapping with minimum score filtering — v4.0
- ✓ Auto-save qualifying papers to library with computed rating and collection assignment — v4.0
- ✓ Configuration dialog with scoring rules editor, star threshold editor, collection picker, cost estimate, and dismiss guards — v4.0
- ✓ Real-time progress tracking and paginated job history — v4.0
- ✓ Cancel screening job mutation with credit-guard protection (backend; UI button pending) — v4.0
- ✓ Auth-gated screening export query with bounded results and ownership check — v4.1
- ✓ CSV/JSON/XLSX screening export with dynamic question columns and scoring metadata — v4.1
- ✓ Export dropdown UI on job history cards with format selection, loading states, and 6-locale i18n — v4.1
- ✓ Failed/skipped paper handling with null fallbacks in all export formats — v4.1
- ✓ Simplified star thresholds: minScore-only with descending first-match scoring algorithm — v4.1
- ✓ Backward-compatible schema evolution for maxScore removal (optional in read, removed from write) — v4.1

- ✓ Structural assertion tests replacing snapshot tests for insights UI — v5.0
- ✓ i18n keys seeded across all 6 locale files before UI component development — v5.0
- ✓ Color-coded summary cards with threshold-based green/yellow/red accents — v5.0
- ✓ Contextual ConfidenceBadge replacing "effective confidence" with source tooltip — v5.0
- ✓ Relative-to-max bar scaling with stacked horizontal Recharts bars, lazy-loaded — v5.0
- ✓ Question list status dots and mini progress bars for at-a-glance scanning — v5.0
- ✓ Answer semantic grouping merging case/whitespace/synonym variants with expandable drill-down — v5.0
- ✓ Recharts lazy-loaded via next/dynamic only when insights tab accessed — v5.0

- ✓ Scorched-earth teardown of legacy extraction code (~15,800 LoC), 11 tables, RAG component, i18n keys — v6.0
- ✓ New slim extraction schema (4 tables), durable workflow with batched enqueue, extractionPool workpool — v6.0
- ✓ Free-first parsing waterfall: PMC JATS → arXiv HTML → unpdf → Gemini-as-PDF-parser → abstract-only with abort-signal ceilings and 200-page cap — v6.0
- ✓ Three-tier OpenRouter cascade (Flash Lite → Flash → Haiku) with flat 7-field Zod schema, propertyOrdering, concurrency cap 5 — v6.0
- ✓ Deterministic citation grounding: Levenshtein 85% superRefine, critic pass, insufficient_evidence first-class state, UI renders verbatim slice() — v6.0
- ✓ Targeted cancel via per-paper workpoolId, retryable/permanent error taxonomy, early-return guard, reactive progress subscriptions — v6.0
- ✓ Route-segment error boundaries, Clerk visibility-change retry, mutation-to-toast routing — v6.0
- ✓ ULID traceId propagation across all 4 extraction stages, structured JSON logging, per-job metrics query, SLO persistence — v6.0
- ✓ Golden set eval framework, hourly production quality sampling cron, human-review queue backend — v6.0
- ✓ Extraction UI: job creation dialog, live progress with cancel, results cards with verbatim quotes, export, JobMetricsPanel with SLO bars — v6.0

### Active

- v7.0 Extraction Workbench — Phase 102 complete, Phase 103 next (goal + features in `## Current Milestone`)

### Out of Scope

- Adding new subscription tiers or changing pricing — pricing structure audit only
- Migrating away from `@convex-dev/stripe` — work within existing integration
- Stripe Connect or marketplace payments — not applicable
- Mobile payment flows (Apple Pay, Google Pay) — web-only
- Custom proration logic (bypass Stripe) — use Stripe's built-in proration
- Automating Stripe Checkout card entry — Stripe actively blocks automated testing of hosted checkout
- Visual regression / screenshot tests — separate concern, notoriously flaky
- `convex-test` end-to-end auth-gated functions — blocked by convex-test issue #50
- Nested/hierarchical collections — flat collections sufficient for now
- Tags separate from collections — parallel system confuses users
- Smart collections / saved searches — requires continuous query engine
- PDF storage and annotation — users have Zotero for this
- Citation formatting / BibTeX export — entire product category; Zotero handles this
- Collaborative/shared libraries — requires permission models; v3+ at earliest
- localStorage migration on first sign-in — nice-to-have, not blocking
- Infinite scroll — pagination wins on predictability, accessibility, and mobile
- Complex AND/OR/NOT filter logic — all filters apply as AND; deferred until demand
- Real-time multi-user sync — page refresh sufficient for personal library
- AI-powered search or tagging — requires LLM integration; v3+ scope
- Related papers discovery — requires embedding similarity; v3+ scope

## Context

Shipped v1.0 through v6.0 (16 milestones, 97 phases, 208 plans). Latest: v6.0 (342 files, +57,552/-27,902).
Tech stack: Next.js, Convex, Stripe SDK v20.3.0, `@convex-dev/stripe`, next-intl (6 locales), nuqs (URL state), Zustand (sidebar stores), Framer Motion (animations), Recharts (lazy-loaded), Playwright, Vitest, convex-helpers (rate limiting), ExcelJS (dynamic import), `@convex-dev/workflow` (durable extraction workflow), `@openrouter/ai-sdk-provider` (LLM cascade), `fastest-levenshtein` (citation grounding), `fast-xml-parser` (PMC JATS), `linkedom` (arXiv HTML), `unpdf` (PDF parsing), `ulid` (trace IDs).
Key tables: `subscriptions`, `credits`, `creditTransactions`, `billingCustomers`, `stripeEventLogs`, `libraryItems`, `collections`, `libraryItemCollections`, `rateLimits`, `zoteroConnections`, `auditLogs`, `screeningJobs`, `screeningResults`, `extractionJobs`, `extractionPapers`, `extractionQuestions`, `extractionResults`, `qualityChecks`.
Extraction pipeline: Free-first parsing waterfall (PMC → arXiv → unpdf → Gemini → abstract-only), three-tier OpenRouter cascade (Flash Lite → Flash → Haiku), deterministic citation grounding (Levenshtein 85% + critic pass), durable workflow with targeted cancel and reactive progress, structured JSON logging with ULID traceId, SLO metrics (recall-on-include, citation-validity-rate).
Test suite: Vitest tests covering unit tests across 7+ domains + extraction pipeline, parsing waterfall, error classification, citation grounding, eval framework. Playwright billing E2E suite (6 spec files, 11 tests). Zero TypeScript compile errors (`tsc --noEmit` clean).
Known v6.0 gaps: Job creation flow unreachable (ExtractionDialog papers prop unconnected), quality trend/review queue backends have no UI consumers, `provider.order` missing from cascade config.

## Constraints

- **Platform**: All billing logic must run in Convex (actions/mutations) — no standalone API server
- **Existing component**: Must work with `@convex-dev/stripe` — don't bypass it unless necessary
- **Webhook-driven**: Stripe state changes must be driven by webhooks, not client-side polling
- **Idempotency**: All webhook handlers must be idempotent (events can be delivered multiple times)
- **Test isolation**: Each E2E test gets a fresh Clerk user — no shared state between tests
- **TDD standard**: All new features must be built test-first using red-green-refactor

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Upgrade = immediate proration charge | Industry standard; users expect to pay difference now | ✓ Good — `always_invoice` + `error_if_incomplete` |
| Downgrade = end of billing period | Users keep what they paid for; standard practice | ✓ Good — subscription schedule approach |
| Work within @convex-dev/stripe | Existing integration, no need to replace | ✓ Good — no conflicts encountered |
| Webhook re-fetch from Stripe API | Event payloads can arrive out of order | ✓ Good — eliminates state corruption |
| In-place cancellation (no orphan records) | Preserve audit trail with stripeSubscriptionId | ✓ Good — clean data model |
| 7-day grace period for past_due | Balance user access with payment recovery | ✓ Good — auto-downgrades after expiry |
| Safety cap of 500 invoices per customer | Prevent unbounded iteration in reconciliation | ✓ Good — defensive limit |
| TOCTOU mitigation = per-user workpool | Simpler than version field, triggers on incident | — Pending (documented, not yet needed) |
| Pin proration_date between preview and execution | Prevents charge drift from Stripe per-second proration | ✓ Good — exact match guaranteed |
| Tri-state toast (success/processing/error) | Server-reported creditsGranted drives feedback | ✓ Good — no misleading UI |
| Webhook backup path for credit grants | Dual-path convergence with dedup | ✓ Good — resilient to action-path failures |
| Checkout-bypass pattern for E2E tests | Stripe blocks hosted checkout automation | ✓ Good — reliable, fast, deterministic |
| workers: 1 for billing tests | Clerk concurrent auth bug (#7891) | ✓ Good — eliminates flakes |
| Structural prompt testing (no AI quality) | Decouples test suite from AI model behavior | ✓ Good — stable tests |
| .parse()/.safeParse() only for Zod testing | Avoids coupling to Zod internals | ✓ Good — version-stable |
| vi.resetModules() for env var isolation | Module-load-time env vars need fresh imports | ✓ Good — reliable feature flag tests |
| toBeCloseTo for cost assertions | IEEE 754 floating-point precision | ✓ Good — no false failures |
| Representative models per provider | Avoid brittle snapshot of all 40+ models | ✓ Good — maintainable |
| Mock at module boundary (vi.mock) | Tests batch orchestration independent of AI SDK | ✓ Good — fast, isolated |
| Slim typed fields for libraryItems | Enforces 1-2 KB at schema level, not runtime | ✓ Good — clean normalized storage |
| Dual-path query (search + browse) | Search index for relevance, regular indexes for custom sort | ✓ Good — optimal for both use cases |
| Junction table for collections | Many-to-many without array field limitations | ✓ Good — cascade delete, count queries |
| Fire-and-forget mutation for rating saves | Zustand optimistic, Convex failure logged but never blocks UI | ✓ Good — responsive UX |
| nuqs for URL state persistence | Bookmarkable filtered views, framework-native | ✓ Good — zero client-side state management |
| Shared FilterSection component | DRY between search and library pages | ✓ Good — consistent UX, single source of truth |
| Async toast pattern for destructive actions | .then/.catch replaces fire-and-forget for user feedback | ✓ Good — clear success/error feedback |
| createSidebarStore factory for independent stores | Each page gets own Zustand store with distinct localStorage key | ✓ Good — no cross-page state leaks |
| FilterSidebar chrome shell with content slot | Generic frame accepting arbitrary filter content via children | ✓ Good — zero duplication across pages |
| SidebarLayout responsive branching on useIsMobile | Desktop two-column vs mobile tabs from single component | ✓ Good — consistent responsive behavior |
| exportItems.length as pagination total | Non-paginated export query gives accurate filtered count | ✓ Good — always correct, no separate count query |
| Page reset on filter/sort/search changes | Prevents showing empty pages when filter reduces result set | ✓ Good — predictable navigation |
| requirePublicDebugEnabled() gate | Consistent entry-point security for all debug/test handlers | ✓ Good — no debug leaks to production |
| Lazy getStripe() singleton | Throws only when called with missing key, not at module load | ✓ Good — no import-time crashes |
| Shared crypto.ts module | AES-256-GCM encrypt/decrypt extracted from apiKeys for reuse | ✓ Good — DRY crypto, used by Zotero + API keys |
| scheduler.runAfter(0) for cascade deletion | Avoids recursive ctx.runMutation stack overflow on large jobs | ✓ Good — reliable batch deletion |
| resolveZoteroApiKey dual-read fallback | Checks encryptedApiKey first, falls back to plaintext for migration | ✓ Good — zero-downtime migration (now encrypted-only) |
| defineRateLimits token-bucket pattern | Centralized rate limit config with convex-helpers | ✓ Good — consistent enforcement |
| vi.useFakeTimers() before scheduler mutations | Scheduler timing must be controlled before mutation triggers | ✓ Good — reliable test timing |
| Two-deploy migration for apiKey removal | Migrate data first, then deploy schema removal | ✓ Good — zero-downtime, no data loss |
| Credit-guard pattern in workpool actions | Fresh DB read before deduction prevents cancelled-job billing | ✓ Good — 0-2 paper race window acceptable |
| cancelAll() for workpool cancellation | Cancels ALL pending items; credit guards protect non-cancelled jobs | ✓ Good — simple, correct |
| Deferred user hard-delete on batch overflow | Skip hard-delete when extraction jobs exceed batch limit | ✓ Good — ensures complete cascade |
| statusResultValidator for typed query returns | Replaces manual v.union patterns across all auth-gated queries | ✓ Good — consistent, DRY |
| Inline validators for computed shapes | Aggregated data uses inline v.object() not shared validators | ✓ Good — avoids false coupling |
| .collect() for OAuth token cleanup | Table tiny (0-5 rows), no index needed | ✓ Good — simple, correct |
| try-catch per delete in cron | Handles concurrent deletion race with getRequestToken | ✓ Good — resilient cleanup |
| Ref-injection pattern for webhook handler testing | Extract pure functions, inject Convex refs as parameter | ✓ Good — testable without convex-test |
| Convex source of truth for pending plan changes | Stripe metadata preserved for backward compat only | ✓ Good — eliminates Stripe metadata dependency |
| Centralized decryptApiKey with audit logging | Single utility, structured [AUDIT:KEY_DECRYPT] logs | ✓ Good — complete audit trail |
| Debug gate audit trail with [AUDIT:DEBUG_ACCESS] | Structured console.log for grep-friendly Convex logs | ✓ Good — tracks all debug access |
| Batch review loading via loadReviewsByJob | Single by_job query replaces N per-paper round trips | ✓ Good — eliminates N+1 |
| MAX_PAPERS_PER_JOB = 500 safety bound | Applied to all per-job paper queries and mutations | ✓ Good — prevents unbounded memory |
| Required refs in stripeWebhookHandlers | All callers always provide refs via wrapper functions | ✓ Good — eliminates undefined errors |
| Double cast (as unknown as X) for Stripe v20 tests | Union type makes Partial resolve to last member | ✓ Good — clean test mocks |
| Derive ExtractionResultWithReview from Convex validator | Single source of truth, zero manual type maintenance | ✓ Good — used in export, filtering, table-view |
| Branded WorkflowId cast instead of as-any | Type-safe bridge for @convex-dev/workflow API | ✓ Good — preserves type information |
| v.union(v.literal(...)) for rate limiter names | Runtime validation matches defineRateLimits keys | ✓ Good — invalid names rejected at boundary |
| SubscriptionItem for period boundaries | Stripe API 2026-01-28 removed subscription-level fields | ✓ Good — future-proof |
| Text splitting over innerHTML for highlighting | Zero-dep, XSS-safe by construction | ✓ Good — no sanitization needed |
| Persistent auditLogs table over console.log | Queryable audit trail for security investigations | ✓ Good — structured, persistent |
| Cron-based env var validation | Handler-level too late, module-scope blocks all functions | ✓ Good — 24h catch window |
| Circuit-breaker cron with self-scheduling | Fresh 45s budget per batch prevents Stripe rate limit exhaustion | ✓ Good — scales with subscriber growth |
| extractionJobStats incremental upsert | Decouple report generation from loading all results | ✓ Good — enables future 500-paper cap lift |
| Stats fast path only for summary counters | Per-question detail requires fan-out; scope guard for filtered reports | ✓ Good — 80/20 optimization |
| Lazy backfill for legacy job stats | Compute and persist on first access, not migration | ✓ Good — zero-downtime |
| ExcelJS dynamic import | ~500KB bundle savings, maintained library | ✓ Good — CJS/ESM interop guard handles both formats |

| GenericValidator replaces Validator<any,any,any> | SDK alias, zero behavior change, eliminates last <any> pattern | ✓ Good — 11 call sites updated |
| Return null on auth/ownership failure for export query | Consistent with existing query patterns, no info leak | ✓ Good — no throws in query layer |
| Inline downloadFile helper for screening export | Avoids cross-module coupling with extraction export | ✓ Good — self-contained module |
| Separate generate* pure functions from export* wrappers | Pure functions testable without DOM, wrappers trigger download | ✓ Good — 19 unit tests on pure functions |
| useConvex().query() for on-demand export fetch | Export is one-shot action, not continuous data subscription | ✓ Good — no reactive overhead |
| v.optional(v.number()) for maxScore backward compat | Existing stored documents may have maxScore, read validators must accept both | ✓ Good — zero-downtime schema evolution |
| Descending-minScore first-match scoring | Simple mental model: highest matching floor wins | ✓ Good — eliminates range overlap complexity |
| Reuse extraction workflow+workpool pattern for screening | Proven pattern, minimal new infrastructure | ✓ Good — separate screeningPool for isolation |
| Pure-function scoring engine | No external library, testable, composable | ✓ Good — 5 pure functions with full TDD |
| First-match-wins for overlapping star thresholds | Array order determines priority, simple mental model | ✓ Good — documented behavior |
| Default scoring yes=1/no=0/null=0 with auto star thresholds | Sensible defaults from question count | ✓ Good — zero-config path works |
| Configure-vs-progress dialog modes via activeJobId state | Single dialog component, two modes | ✓ Good — clean state management |
| JSON serialization for Clerk webhook data | Convex 1.32.0 lacks v.unknown(); JSON string workaround | ✓ Good — type-safe boundary |
| DeepPartial<T> mock factories | Selective nested mock customization without as any | ✓ Good — 20+ test files migrated |
| GenericActionCtx<GenericDataModel> for Stripe webhooks | Matches @convex-dev/stripe StripeEventHandler callback signature | ✓ Good — cross-library type boundary |
| as never for Convex useQuery/usePaginatedQuery boundary | Satisfies generic constraints without widening to any | ✓ Good — used in use-auth-query, hook-factory |
| Internal function registration for debug endpoints | Platform-enforced unreachability vs runtime env-var gate | ✓ Good — eliminates debug_gate.ts, no env var needed |
| Denormalized libraryItemCount counter | O(1) read vs O(N) scan, low write contention | ✓ Good — atomic maintenance in 3 mutation paths |
| Math.max(0, count-1) negative counter guard | Prevents edge-case negative counts | ✓ Good — defensive, no correctness impact |
| Shared queryBounds.ts MAX constants | Centralized bounds vs co-located per-file | ✓ Good — prevents inconsistent bounds |
| Cascade deletes left unbounded | Bounding would orphan data | ✓ Good — annotated with comments |

| Structural tests over snapshots | Component refactors don't break tests | ✓ Good — v5.0 insight components iterated freely |
| i18n keys seeded before UI work | Prevents missing-key placeholders in production | ✓ Good — all 6 locales complete before Phase 84 |
| Recharts lazy-loaded via next/dynamic | ~65KB gzipped deferred from initial page load | ✓ Good — only loads on insights tab access |
| normalizeToMax bar scaling | Dominant answer fills container, minorities proportional | ✓ Good — eliminates near-invisible 2-4% bars |
| Synonym grouping: case/whitespace/basic only | MVP complexity; fuzzy/NLP deferred to v5.1+ | ✓ Good — covers common duplicates without over-engineering |
| GroupedAnswerRow local useState | Expansion state not lifted to parent | ✓ Good — simple, no cross-component coupling |
| IIFE pattern for grouping computation in JSX | synonymMap built once, shared by answer and disagreement transforms | ✓ Good — avoids double computation |
| Scorched-earth teardown before rebuild | Delete all legacy code first, build new on clean slate | ✓ Good — zero dangling references, clean namespace |
| OpenRouter via AI SDK 6 as only LLM surface | Single provider abstraction, response-healing plugin | ✓ Good — simplified billing and fallback |
| Gemini Flash / Haiku cascade, no Grok | Grok 4.1 Fast 92.89% JSON validity is a dealbreaker | ✓ Good — strict Zod schemas need reliable JSON |
| Whole-paper extraction (no chunking/RAG) | 1M-context Flash models make chunking unnecessary at MVP | ✓ Good — simpler architecture, no vector DB |
| Levenshtein 85% + critic pass for citation grounding | Deterministic hallucination defense without embeddings | ✓ Good — rejects fabricated quotes at boundary |
| Free-first parsing waterfall | PMC/arXiv free before paid Gemini/PDF path | ✓ Good — minimizes cost for open-access papers |
| ULID traceId propagated across all stages | Grep-friendly incident triage without paid observability | ✓ Good — single ID links parse→extract→critic→save |
| Per-paper workpoolId for targeted cancel | No cancelAll blast radius across users | ✓ Good — fine-grained cancellation |
| Retryable vs permanent error taxonomy | Network/5xx/429 retried, 404/400/validation not | ✓ Good — no wasted retries on permanent failures |
| vitest-evals + autoevals for MVP eval loop | No Langfuse/Braintrust overhead for pre-customer stage | ✓ Good — lightweight, CI-gated |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-16 — Phase 104 (Zotero Revival) complete. ZoteroConnectionCard on /settings/connections with OAuth connect/disconnect, ZoteroTab + ZoteroItemRow in selector page with collection picker, paginated items, lazy DOI resolution, env validation for Zotero secrets, dev-guarded purge action, i18n across 6 locales.*
