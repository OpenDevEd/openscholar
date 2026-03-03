# OpenAlex Count — Academic Search & Extraction Platform

## What This Is

OpenAlex Count is an academic literature search and extraction tool built with Next.js + Convex. It provides AI-powered screening, translation, and data extraction across academic papers sourced from OpenAlex. The platform includes Stripe-integrated billing with subscription tiers (free, go, pro, enterprise), credit-based usage metering, a comprehensive test suite (744 tests across 73 files), a persistent library with collections, advanced filtering, a polished two-column sidebar layout shared across search and library pages, and a fully hardened codebase with zero TypeScript compile errors, typed Stripe handlers, typed extraction validators, encrypted API keys, centralized security with audit logging, and automated cleanup crons.

## Core Value

Reliable, well-tested academic search and AI extraction — every major code path has tests, and every new feature is built test-first.

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

### Active

(No active requirements — planning next milestone)

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

Shipped v1.0 (38 files, +3181/-172), v1.1 (36 files, +4136/-210), v1.2 (1,248 LOC test infra, 351 LOC CI), v2.0 (91 files, +14,768/-100), v2.1 (258 files, +37,922/-3,469), v2.2 (46 files, +7,216/-662), v2.3 (77 files, +8,779/-769), v2.4 (64 files, +6,447/-318), and v2.5 (80 files, +7,858/-1,458).
Tech stack: Next.js, Convex, Stripe SDK v20.3.0, `@convex-dev/stripe`, next-intl (6 locales), nuqs (URL state), Zustand (sidebar stores), Framer Motion (animations), Playwright, Vitest, convex-helpers (rate limiting).
Key tables: `subscriptions`, `credits`, `creditTransactions`, `billingCustomers`, `stripeEventLogs`, `libraryItems`, `collections`, `libraryItemCollections`, `rateLimits`, `zoteroConnections`, `extractionRunDiffs`.
Test suite: 73 Vitest test files (744 tests passing) covering unit tests across 7 domains + Stripe webhook handler, concurrent credit, cascade deletion, and debug gate tests. Playwright billing E2E suite (6 spec files, 11 tests). Zero TypeScript compile errors (`tsc --noEmit` clean).
CI pipeline: 3 billing jobs (billing-live, billing-live-extended, billing-nightly).
Library: Convex-backed with dual-path query (search index + regular indexes), junction table collections, CSV/JSON export, two-column sidebar layout with collapsible filter panel.
Shared UI: SidebarLayout (desktop two-column + mobile tabs), FilterSidebar (collapse/badge/clear chrome), FilterSection (reusable filter group) — used by both search and library pages.
Security: AES-256-GCM encryption for API keys and Zotero keys via centralized `decryptApiKey` with structured audit logging, rate limiting on all exposed endpoints, debug functions gated behind requirePublicDebugEnabled() with audit trail and JSDoc @production annotations.
Extraction: 18 shared typed validators for all extraction document shapes, typed query return validators (zero v.any()), typed searchFilters schema, credit-guard pattern protecting against cancelled-job billing races.
Performance: Batch review loading (no N+1), bounded .collect() calls with .take() guards, `by_expiry` and `by_status_updatedAt` composite indexes, standard crypto import.
Maintenance: Hourly cron for expired OAuth token cleanup, GDPR-compliant user cascade delete covering extraction jobs and Zotero connections.

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

---
*Last updated: 2026-03-03 after v2.5 milestone complete*
