# OpenAlex Count — Academic Search & Extraction Platform

## What This Is

OpenAlex Count is an academic literature search and extraction tool built with Next.js + Convex. It provides AI-powered screening, translation, and data extraction across academic papers sourced from OpenAlex. The platform includes Stripe-integrated billing with subscription tiers (free, go, pro, enterprise), credit-based usage metering, and a comprehensive test suite covering billing, AI, search, export, and auth domains.

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

### Active

**Current Milestone: v2.1 Library & Collections**

- [ ] Rating an item saves it to user's library (full JSON entry in Convex)
- [ ] Dedicated /library page with full filtering (rating, collection, date saved, search, sort)
- [ ] Collection CRUD — users can create, rename, delete collections
- [ ] Items can belong to multiple collections
- [ ] Users can remove items from their library
- [ ] Auth-gated — library only available to signed-in users

### Out of Scope

- Adding new subscription tiers or changing pricing — pricing structure audit only
- Migrating away from `@convex-dev/stripe` — work within existing integration
- Stripe Connect or marketplace payments — not applicable
- Mobile payment flows (Apple Pay, Google Pay) — web-only
- Custom proration logic (bypass Stripe) — use Stripe's built-in proration
- Automating Stripe Checkout card entry — Stripe actively blocks automated testing of hosted checkout
- Visual regression / screenshot tests — separate concern, notoriously flaky
- `convex-test` end-to-end auth-gated functions — blocked by convex-test issue #50

## Context

Shipped v1.0 (38 files, +3181/-172), v1.1 (36 files, +4136/-210), v1.2 (1,248 LOC test infra, 351 LOC CI), and v2.0 (91 files, +14,768/-100).
Tech stack: Next.js, Convex, Stripe SDK v20.3.0, `@convex-dev/stripe`, next-intl (6 locales), Playwright, Vitest.
Key tables: `subscriptions`, `credits`, `creditTransactions`, `billingCustomers`, `stripeEventLogs`.
Test suite: 60+ Vitest test files covering unit tests across 7 domains, Playwright billing E2E suite (6 spec files, 11 tests).
CI pipeline: 3 billing jobs (billing-live, billing-live-extended, billing-nightly).
TOCTOU credit deduction race documented — mitigation triggers on observed incident in prod.

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

## Current Milestone: v2.1 Library & Collections

**Goal:** Persistent server-side library where rating items auto-saves them, with collections and full filtering on a dedicated page.

**Target features:**
- Auto-save rated items to Convex-backed library (full JSON)
- Dedicated /library page with filtering by rating, collection, date saved, text search, and sort
- Collection management (create, rename, delete, assign items to multiple)
- Remove items from library
- Auth-gated (signed-in users only)

---
*Last updated: 2026-02-28 after v2.1 milestone started*
