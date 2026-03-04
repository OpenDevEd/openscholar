# Milestones

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

