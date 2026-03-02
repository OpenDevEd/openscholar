# OpenAlex Count — Academic Search & Extraction Platform

## What This Is

OpenAlex Count is an academic literature search and extraction tool built with Next.js + Convex. It provides AI-powered screening, translation, and data extraction across academic papers sourced from OpenAlex. The platform includes Stripe-integrated billing with subscription tiers (free, go, pro, enterprise), credit-based usage metering, a comprehensive test suite, and a persistent library with collections, advanced filtering, and a polished two-column sidebar layout shared across search and library pages.

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

### Active

(None — planning next milestone)

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

Shipped v1.0 (38 files, +3181/-172), v1.1 (36 files, +4136/-210), v1.2 (1,248 LOC test infra, 351 LOC CI), v2.0 (91 files, +14,768/-100), v2.1 (258 files, +37,922/-3,469), and v2.2 (46 files, +7,216/-662).
Tech stack: Next.js, Convex, Stripe SDK v20.3.0, `@convex-dev/stripe`, next-intl (6 locales), nuqs (URL state), Zustand (sidebar stores), Framer Motion (animations), Playwright, Vitest.
Key tables: `subscriptions`, `credits`, `creditTransactions`, `billingCustomers`, `stripeEventLogs`, `libraryItems`, `collections`, `libraryItemCollections`.
Test suite: 60+ Vitest test files covering unit tests across 7 domains, Playwright billing E2E suite (6 spec files, 11 tests).
CI pipeline: 3 billing jobs (billing-live, billing-live-extended, billing-nightly).
Library: Convex-backed with dual-path query (search index + regular indexes), junction table collections, CSV/JSON export, two-column sidebar layout with collapsible filter panel.
Shared UI: SidebarLayout (desktop two-column + mobile tabs), FilterSidebar (collapse/badge/clear chrome), FilterSection (reusable filter group) — used by both search and library pages.

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

---
*Last updated: 2026-03-02 after v2.2 milestone*
