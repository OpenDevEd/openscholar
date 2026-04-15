# Milestones

## v6.0 Extraction MVP Rebuild (Shipped: 2026-04-15)

**Phases completed:** 10 phases, 29 plans, 52 tasks
**Git range:** `ac55425..82168c4` (212 commits)
**Files changed:** 342 files, +57,552/-27,902 lines
**Timeline:** 2 days (2026-04-14 → 2026-04-15)

**Key accomplishments:**

- Scorched-earth teardown: deleted 93 extraction files (~15,800 LoC), 11 legacy tables, RAG component, 2 dead dependencies, and all extraction i18n keys from 6 locales (Phase 88)
- New slim extraction schema with 4 tables, durable `@convex-dev/workflow` with batched enqueue, idempotent save, and `extractionPool` workpool (Phase 89)
- Free-first parsing waterfall: PMC JATS → arXiv HTML → unpdf → Gemini-as-PDF-parser → abstract-only, with abort-signal ceilings and 200-page cap (Phase 90)
- Three-tier OpenRouter cascade (Flash Lite → Flash → Haiku) with flat 7-field Zod schema, `propertyOrdering`, concurrency cap 5, and credit billing (Phase 91)
- Deterministic citation grounding: Levenshtein 85% superRefine, critic pass, `insufficient_evidence` first-class state, UI renders verbatim `slice()` only (Phase 92)
- Targeted cancel via per-paper workpoolId, retryable/permanent error taxonomy, early-return guard, reactive progress subscriptions (Phase 93)
- Route-segment error boundaries, Clerk visibility-change retry, mutation-to-toast routing, grep-backed useQuery lint test (Phase 94)
- ULID traceId propagation across all 4 extraction stages, structured JSON logging, per-job metrics query, SLO persistence (Phase 95)
- Golden set eval framework, hourly production quality sampling cron, human-review queue backend (Phase 96)
- Extraction UI: job creation dialog, live progress with cancel, results cards with verbatim quotes, export, JobMetricsPanel with SLO bars (Phase 97)

**Audit:** 53/63 requirements satisfied, 3 unsatisfied (EVAL-05, EVAL-06, UI-01), 4 partial (EXTR-07, WORK-06, CRASH-02, PARSE-07)

**Known Gaps:**
- EVAL-05: `getQualityTrend` backend query exists but no UI consumer renders the 7-day rolling dashboard
- EVAL-06: `getReviewQueue`/`updateReviewStatus` exist but no UI page for the human-review queue
- UI-01: ExtractionDialog exists but `papers` prop is never passed — job creation unreachable from UI
- EXTR-07: `provider.order` not set in OpenRouter cascade config
- WORK-06: `enqueueAllPapers` test doesn't invoke the mutation (seeds papers only)
- CRASH-02: EvidenceQuote and JobMetricsPanel use bare `useQuery` instead of `useProtectedQuery`
- PARSE-07: `parsingSource` stored in schema but UI rendering not confirmed on result cards

**Tech debt carried forward:**
- Job creation flow dead (ExtractionDialog papers prop unconnected)
- TierSelector value never sent to backend — cascade always runs all 3 tiers
- Quality trend and review queue backends are write-only (no UI consumers)
- `provider.order` missing from OpenRouter cascade config
- `enqueueAllPapers` mutation test gap

---

## v5.0 Extraction Insights Overhaul (Shipped: 2026-03-10)

**Phases completed:** 5 phases, 14 plans
**Git range:** `6b23d6c..9ce0704` (65 commits)
**Files changed:** 83 files, +12,465/-149 lines
**Timeline:** 1 day (2026-03-10)

**Key accomplishments:**

- Test foundation with structural assertions replacing snapshots and 11 new i18n keys seeded across all 6 locale files upfront (Phase 83)
- Color-coded summary cards with threshold-based green/yellow/red accents and contextual ConfidenceBadge replacing confusing "effective confidence" display (Phase 84)
- Relative-to-max bar scaling with Recharts stacked horizontal bars, lazy-loaded via next/dynamic to avoid ~65KB gzipped on initial page load (Phase 85)
- Question list with status dots (green/yellow/grey) and mini progress bars showing answer completion percentage at a glance (Phase 86)
- Answer semantic grouping merging case/whitespace/synonym variants into single rows with expandable drill-down to inspect individual variants and counts (Phase 87)

**Audit:** 19/19 requirements, 5/5 phases, 18/18 integrations, 4/4 E2E flows — PASSED

**Tech debt carried forward:**

- TypeScript `any` on Recharts tooltip props (stacked-answer-bars.tsx:174) — Recharts type incompatibility, safe in practice
- Old div-based Bar component retained for citationStatusMix (correct design decision, Recharts not needed)

---

## v4.1 Screening Export (Shipped: 2026-03-09)

**Phases completed:** 4 phases, 5 plans, 10 tasks
**Git range:** `23a790c..bfb8640` (21 commits)
**Files changed:** 45 files, +5,020/-153 lines
**Timeline:** 1 day (2026-03-09)

**Key accomplishments:**

- Auth-gated getScreeningResultsForExport query with ownership check, bounded read, and explicit field mapping (Phase 79)
- CSV, JSON, and XLSX screening export functions with dynamic question columns, Yes/No/N/A answer formatting, and graceful failed/skipped paper handling (Phase 80)
- Export dropdown UI on screening job history cards with format selection, loading spinner, incomplete-job warnings, and full 6-locale i18n (Phase 81)
- Simplified star thresholds to minScore-only with descending-sort first-match scoring algorithm, removing maxScore from schema write path, validators, UI, and export (Phase 82)
- Full backward compatibility — existing screening jobs with stored maxScore data continue to work via v.optional() in read validators and export types (Phase 82)

**Audit:** 14/14 requirements, 4/4 phases, 10/10 integrations, 3/3 E2E flows — PASSED

**Tech debt carried forward:**

- Unused `exportLoading` translation key in 6 locale files (cosmetic, loading state uses Loader2 icon instead)

---

## v4.0 Bulk Screening & Auto-Rating (Shipped: 2026-03-09)

**Phases completed:** 4 phases, 9 plans
**Git range:** `75d174b..c0e7235` (42 commits)
**Files changed:** 56 files, +8,557/-90 lines
**Timeline:** 1 day (2026-03-09)

**Key accomplishments:**

- Schema & job infrastructure with screeningJobs/screeningResults tables, dedicated screening workpool, and credit-gated createScreeningJob/cancelScreeningJob mutations with 9+ TDD tests (Phase 75)
- Pure scoring engine with per-question point rules (yes/no/null → +/- points), score-to-star threshold mapping, minimum score filtering, and config validation (Phase 76)
- Background workflow pipeline processing up to 200 papers with AI screening, scoring, auto-save qualifying papers to library with computed rating, and collection assignment (Phase 77)
- Configuration dialog with scoring rules editor, star threshold editor, collection picker (with create-new), cost estimate, paper count, and dismiss guards (Phase 78)
- Real-time progress tracking via reactive queries, status badge mapping, and paginated job history list with date/status display (Phase 78)

**Audit:** 22/23 requirements satisfied, JOB-07 cancel UI gap (backend mutation exists, no UI button)

**Known Gaps:**

- JOB-07: cancelScreeningJob mutation implemented with 9 passing tests, but no cancel button in ScreeningProgress or ScreeningDialog UI

**Tech debt carried forward:**

- Cancel button UI for running screening jobs (JOB-07)
- Counter contention risk when bulk-saving 200 papers (documented, not yet observed)

---

## v3.2 Production Readiness (Shipped: 2026-03-06)

**Phases completed:** 3 phases, 4 plans, 7 tasks
**Git range:** `1dac00b..d047fd6` (11 source commits)
**Files changed:** 79 files, +2,240/-1,803 lines
**Timeline:** 1 day (2026-03-06)

**Key accomplishments:**

- Debug endpoints converted to internal functions — platform-enforced unreachability replaces env-var gates, debug_gate.ts deleted (Phase 72)
- O(1) library count via denormalized libraryItemCount field with atomic counter maintenance in all 3 mutation paths (Phase 73)
- All high-traffic .collect() calls bounded with .take(N) guards using shared MAX constants from queryBounds.ts (Phase 74)
- ~40 naturally-bounded queries annotated with cardinality comments, cascade deletes verified safe from over-bounding (Phase 74)
- 8 new counter tests + 13-assertion internal registration test added (786 total tests passing)

**Tech debt carried forward:** None

---

## v3.1 Complete Type Safety (Shipped: 2026-03-05)

**Phases completed:** 12 phases, 20 plans
**Git range:** `93febde..0878e73` (82 commits)
**Files changed:** 143 files, +9,047/-676 lines
**Timeline:** 2 days (2026-03-04 → 2026-03-05)

**Key accomplishments:**

- All 9 v.any() validators replaced with typed alternatives including JSON serialization workaround for Clerk webhooks (Phase 60)
- Extraction and billing backends fully typed — workflow, workpoolActions, mutations, subscriptions, credits, stripeWebhookHandlers with zero `: any`, `as any`, or `any[]` (Phases 61, 68)
- Client libraries and React components typed — 40+ any instances eliminated across utils, store, auth, extraction, AI libraries and 10+ components (Phases 63, 64)
- Typed mock factory infrastructure — DeepPartial factories for Convex context, Ids/documents, and Stripe events enabling type-safe test mocks (Phase 65)
- All 20+ test files typed — 85+ `as any` casts replaced using mock factories (Phase 66)
- Zero-any verified — `tsc --noEmit` zero errors, `verify-no-any.sh` catches `: any`, `as any`, `any[]`, and `<any>` patterns (Phases 67, 69, 71)

**Audit:** 18/18 requirements, 12/12 phases, 47/47 integrations, 6/6 E2E flows — PASSED

**Tech debt carried forward:** None — all 5 debt items from initial audit resolved by gap-closure phases 70 and 71

---

## v3.0 Zero-Any Overhaul (Shipped: 2026-03-04)

**Phases completed:** 6 phases, 11 plans
**Git range:** `70ca612..0e9c435` (57 commits)
**Files changed:** 82 files, +10,498/-893 lines
**Timeline:** 2 days (2026-03-03 → 2026-03-04)

**Key accomplishments:**

- Eliminated all `as any` casts from production code — ExtractionResultWithReview derived from validator, branded WorkflowId, v.union for rate limiter, typeof narrowing for Stripe customer (Phase 54)
- XSS-safe HighlightedText component replacing all dangerouslySetInnerHTML with React-native text splitting and 12 security tests (Phase 55)
- Persistent audit logging table with writeAuditLog internalMutation, env var validation cron, assertPlanPriceConfig fail-fast, and debug exclusion strategy docs (Phase 55)
- Incremental extraction report aggregation via extractionJobStats table with per-question counters, lazy backfill for legacy jobs, and stats-backed report queries (Phase 57)
- ExcelJS migration with dynamic import (~500KB bundle savings), bounded getLibraryCount, subscription cron batching with 45s circuit-breaker (Phases 56)
- 45+ new tests covering credit concurrency OCC, XSS safety, GROBID fallback chain, env validation, ExcelJS round-trip, and subscription cron correction (Phase 58)

**Audit:** 28/28 requirements, 6/6 phases, 28/28 integrations, 4/4 E2E flows — PASSED

**Tech debt carried forward:**

- 33 `as any` casts remain in test/debug files (outside TYPE-0X scope, low severity)
- Stale Convex codegen types for audit/envValidation (resolves on `npx convex deploy`)
- Per-question report detail still requires fan-out (summary/metrics use fast path)

---

## v2.5 Tech Debt Purge (Shipped: 2026-03-03)

**Phases completed:** 7 phases, 15 plans
**Git range:** `86f8e4b..ba8a552` (54 commits)
**Files changed:** 80 files, +7,858/-1,458 lines

**Key accomplishments:**

- Built test safety net with Stripe webhook handler, concurrent credit deduction, and debug gate bypass tests (Phase 47)
- Type-safe Stripe billing with zero `as any` casts and pending plan change state migrated from Stripe metadata to Convex (Phase 48)
- Typed extraction/library queries with proper `Id<"extractionJobs">`, typed pagination validators, and `searchFiltersValidator` (Phase 49)
- Centralized `decryptApiKey` with structured audit logging, made `encryptedApiKey` required in schema, strengthened debug gate (Phase 50)
- Fixed N+1 review loading with batch query, bounded all unbounded `.collect()` calls, added `by_expiry` and `by_status_updatedAt` indexes (Phase 51)
- Removed unused dependencies (ollama, unpdf, 20 individual Radix packages), decomposed focus-mode.tsx monolith (Phase 52)
- Zero TypeScript compile errors across entire codebase — resolved all 19 Stripe v20 type errors in production and test files (Phase 53)

**Audit:** 31/31 requirements, 7/7 phases, 28/28 integrations, 5/5 E2E flows — PASSED

**Tech debt carried forward:**

- `(error as any).decline_code` in actions.ts (Info — Stripe-specific property, intentional)
- `Record<string, any>` local patch accumulator in internal.ts (Info — not a type-safety gap)
- Stripe metadata dual-read for `upgradeFromPlan` (Info — backward-compatible migration path)

---

## v2.4 Concerns Sweep (Shipped: 2026-03-03)

**Phases completed:** 4 phases, 7 plans
**Git range:** `3343b5e..a1a0f25` (30 commits)
**Files changed:** 64 files, +6,447/-318 lines

**Key accomplishments:**

- Migrated plaintext Zotero API keys to encrypted storage and removed deprecated apiKey field from schema and all code paths
- Fixed extraction cancellation with workflow.cancel(), workpool.cancelAll(), and credit-guard protection in action handlers
- Fixed orphan diffs on baseline job deletion, added diff truncation metadata with i18n UI banner, extended GDPR cascade delete to extraction data
- Created 18 shared extraction validators and replaced v.any() in all 11 query return validators with typed alternatives
- Typed migrateSearchHistoryState and attachReviewMetadata; removed getJobDetails 100-paper cap
- Added hourly cron for expired Zotero OAuth token cleanup with concurrent-safe per-delete handling

**Audit:** 15/15 requirements, 4/4 phases, 15/15 integrations, 6/6 E2E flows -- PASSED

**Tech debt carried forward:**

- searchFilters uses v.record(v.string(), v.any()) -- intentional schema design for arbitrary user filter state
- paginatedAnyResultValidator uses v.any() -- explicitly scoped out as lower priority
- workflowId as any cast in cancelExtraction -- Convex SDK limitation, pre-existing
- OPENALEX_CONTACT_EMAIL env var must be set in Convex dashboard for BUG-05 to fully activate

---

## v2.3 Codebase Hardening (Shipped: 2026-03-02)

**Phases completed:** 8 phases, 14 plans
**Git range:** `1235d44..d89edf8` (57 commits)
**Files changed:** 77 files, +8,779/-769 lines

**Key accomplishments:**

- Removed all debug artifacts (console.log, @ts-ignore) and gated test functions behind requirePublicDebugEnabled()
- Replaced all `ctx: any`, `internal as any`, and `components as any` casts with proper Convex-generated types across 11 files
- Encrypted Zotero API keys at rest with AES-256-GCM via shared crypto module, with idempotent migration action
- Built full cascade deletion for extraction jobs covering 8 child tables with scheduler-based batching and PDF storage cleanup
- Parallelized N+1 extraction queries with Promise.all and bounded all unbounded .collect() calls with safety caps
- Enforced token-bucket rate limits on all 6 exposed endpoints via convex-helpers defineRateLimits
- Added integration tests for cascade delete, Zustand 5-version migration chain, and extraction insight edge cases

**Audit:** 27/27 requirements, 8/8 phases, 28/28 integrations, 3/3 E2E flows — TECH_DEBT (minor)

**Tech debt carried forward:**

- New `as any` cast in convex/lib/rateLimit.ts:52 (Low — fixable with proper type cast)
- 9 pre-existing Stripe SDK `as any` casts in http.ts and subscriptions/actions.ts (Info — out of scope)
- Live deployment verification pending for schema additions (Info — structural checks pass)

---

## v1.0 Stripe Integration Audit (Shipped: 2026-02-27)

**Phases completed:** 3 phases, 7 plans
**Git range:** `d0aff9e..ae7c867` (29 commits)
**Files changed:** 38 files, +3181/-172 lines

**Key accomplishments:**

- Webhook handlers re-fetch from Stripe API, eliminating out-of-order event state corruption
- Upgrades charge proration immediately via `always_invoice` with card decline blocking
- Payment failure grace period with auto-downgrade after 7 days and billing UI banner
- Paginated reconciliation cron with dedup contracts for credit grant correctness
- Credit cap banner, checkout processing state with toast, and Buy Credits links throughout UI
- Corrective subscription sync cron and failed event monitoring
- Idempotency and TOCTOU contracts documented on all financial webhook handlers

---

## v1.1 Upgrade Flow (Shipped: 2026-02-27)

**Phases completed:** 3 phases, 6 plans
**Git range:** `326a94f..a49d797` (25 commits)
**Files changed:** 36 files, +4,136/-210 lines

**Key accomplishments:**

- Pinned proration_date between preview and execution so charge matches preview exactly
- Tri-state toast: actual credit count on success, processing message on grant failure, error on card decline
- Webhook-driven backup path grants pro-rata credits when action-path fails (invoice.paid handler)
- Upgrade metadata (fromPlan, toPlan, upgradeTimestamp) written atomically to Stripe subscriptions
- subscription_update firewall prevents double-grants when both action and webhook paths succeed
- Payment method (card brand + last4) and line item breakdown in upgrade confirmation dialog
- Dismiss guard prevents dialog close during processing (Escape, click-outside, close button)
- Full i18n translations for upgrade dialog across 6 locales

**Tech debt carried forward:**

- 9 human verification items requiring Stripe test mode
- 3 pre-existing TypeScript errors in test files (unrelated to milestone)

---

## v1.2 E2E Billing Tests (Shipped: 2026-02-28)

**Phases completed:** 7 phases, 11 plans
**Deliverables:** 1,248 LOC TypeScript (e2e/billing), 351 LOC YAML (CI workflows)

**Key accomplishments:**

- Complete Playwright billing test infrastructure: fixtures with fresh Clerk user isolation, Stripe checkout-bypass helpers, Convex webhook waiter, BillingPage + PricingPage POMs with 18 data-testid attributes
- 6 E2E spec files (11 tests total) covering subscription, upgrade, downgrade, cancellation, credit grants (signup, pro-rata, topup), free credit cap, and dedicated CRED-02 regression
- CI pipeline integration: `test:billing:e2e` npm script wired into all 3 billing CI jobs with env vars, Playwright browser install, test execution, and artifact upload
- Gap closures across 3 phases: credits spec auth wiring (Phase 10), tech debt cleanup (Phase 11), CI env hardening + CRED-02 regression (Phase 13)
- 18/18 requirements verified across 3 independent sources (VERIFICATION.md + SUMMARY frontmatter + REQUIREMENTS.md traceability) with full cross-phase integration check

**Tech debt carried forward:**

- STRIPE_PRO_PRICE_ID not validated in CI preflight steps (Low)
- billing-live-extended job has no secrets validation step (Low)
- 2 unused POM locators in BillingPage (freeCredits, paidCredits) (Info)

---

## v2.0 TDD & Test Coverage (Shipped: 2026-02-28)

**Phases completed:** 8 phases, 17 plans
**Git range:** `a3eb1ea..de4ff5a` (63 commits)
**Files changed:** 91 files, +14,768/-100 lines

**Key accomplishments:**

- Multi-environment Vitest config (node, edge-runtime, jsdom) with zero-regression on 43 existing tests
- AI prompt builder structural tests, Zod schema contract tests, and question key codec round-trip tests
- Fail-soft batch processing tests covering all-success, all-fail, and partial-failure scenarios with mock isolation
- Cost calculation and model registry tests across 4 AI providers (OpenAI, Anthropic, Google, DeepSeek)
- Search parameter, region codec bijectivity, filter builder, and URL serialization round-trip tests
- CSV/JSON export, answer formatting, citation helper, and download output tests with PDF feature flag gating
- Auth state machine, user creation atomicity, ensureUser first-login/return-visit, and profile sync guard tests
- Plan config shape contracts, tier enforcement, feature flag env var isolation, and subscription selection priority tests

**Delivered:** 41/41 requirements complete across 7 test domains (infrastructure, AI prompts, AI batch, AI cost, search, export, auth/plan)

---

## v2.1 Library & Collections (Shipped: 2026-03-01)

**Phases completed:** 8 phases, 15 plans
**Files changed:** 258 files, +37,922/-3,469 lines
**Timeline:** 2 days (2026-02-28 → 2026-03-01)

**Key accomplishments:**

- Persistent server-side library with auto-save on rating: Convex upsert mutation, trimmed 10-field metadata, dual-path query strategy (search index for relevance, regular indexes for custom sort)
- Dedicated /library page with search, filter by rating/date/year/collection, sort by 3 fields, server-side pagination, auth gate, and empty states
- Collection CRUD with many-to-many junction table, cascade delete, item count badges, and collection-filtered browsing
- Advanced filtering with URL state persistence via nuqs — bookmarkable/shareable filtered views with debounced search
- CSV/JSON export supporting filter-aware subset export, reusing existing export utilities
- Mobile responsive layout with 44px touch targets, 6-locale i18n with French diacritic audit, toast feedback on all destructive actions
- Shared FilterSection component extracted from search page for DRY cross-page filtering

**Audit:** 28/28 requirements, 8/8 phases, 28/28 integrations, 7/7 E2E flows — PASSED

**Tech debt carried forward:**

- 3 pre-existing TypeScript errors in test files (from earlier milestones)
- Export in search mode returns relevance order, not user sort (by design)

---

## v2.2 Library UI Overhaul (Shipped: 2026-03-02)

**Phases completed:** 4 phases, 7 plans
**Git range:** `fef4c0d..9e94b28` (34 commits)
**Files changed:** 46 files, +7,216/-662 lines
**Timeline:** 2 days (2026-03-01 → 2026-03-02)

**Key accomplishments:**

- Built SidebarLayout + FilterSidebar reusable primitives with Zustand store factory, Framer Motion animations, and full i18n support across 6 locales
- Refactored search page to use new SidebarLayout + SearchFilterSidebar composition, proving the shared infrastructure under production conditions
- Overhauled library page with full filter sidebar (rating, date saved, year range, collection, text search) and URL state persistence via nuqs
- Added sort controls (date saved, year, rating, title), pagination bar with "X-Y of Z papers" counts, and list/grid view toggle
- Achieved DRY architecture: both search and library pages share identical layout infrastructure (SidebarLayout, FilterSidebar, FilterSection) with zero duplication

**Audit:** 23/23 requirements, 4/4 phases, 23/23 integrations, 5/5 E2E flows — PASSED

**Tech debt carried forward:**

- `app/test-sidebar/page.tsx` orphaned proof-of-concept page (safe to delete)
- `components/library/library-filters.tsx` unused old grid layout (safe to delete)
- 3 pre-existing TypeScript errors in test files (from earlier milestones)

---
