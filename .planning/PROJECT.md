# OpenAlex Count — TDD & Test Coverage

## What This Is

OpenAlex Count is an academic literature search and extraction tool built with Next.js + Convex. Previous milestones (v1.0–v1.2) audited, hardened, and E2E-tested the Stripe billing integration. This milestone establishes strict TDD (red-green-refactor) as the development standard and backfills high test coverage across the three core domains: search & extraction, AI/LLM features, and user management.

## Core Value

Every major code path in search, AI, and user management has tests — and every new feature is built test-first using strict red-green-refactor TDD.

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
- ✓ E2E test framework configured with Playwright billing project (INFRA-01) — v1.2
- ✓ Fresh Clerk test user created and deleted per test scenario (INFRA-02) — v1.2
- ✓ Webhook waiter polls Convex for state convergence before UI assertions (INFRA-03) — v1.2
- ✓ Stripe helpers for subscriptions, payment methods, and cleanup (INFRA-04) — v1.2
- ✓ Page Object Models for billing and pricing pages with data-testid selectors (INFRA-05) — v1.2
- ✓ data-testid attributes on billing UI components for stable test targeting (INFRA-06) — v1.2
- ✓ Billing fixture composes user lifecycle, Stripe, webhooks, and cleanup (INFRA-07) — v1.2
- ✓ Subscribe free to Go and Pro via checkout-bypass (SUB-01, SUB-02) — v1.2
- ✓ Upgrade Go to Pro via in-app confirmation dialog with proration (PLAN-01) — v1.2
- ✓ Downgrade Pro to Go with pending-change banner and scheduled badge (PLAN-02) — v1.2
- ✓ Cancel scheduled downgrade to keep Pro (PLAN-03) — v1.2
- ✓ Cancel subscription shows "Expires on" (CNCL-01) — v1.2
- ✓ Free signup credits on account creation (CRED-01) — v1.2
- ✓ Monthly credits on subscription 3k Go / 15k Pro with dedicated regression test (CRED-02) — v1.2
- ✓ Pro-rata credits on upgrade matching calculated floor(remainingRatio * creditDelta) (CRED-03) — v1.2
- ✓ Credit topup via checkout-bypass (CRED-04) — v1.2
- ✓ Free-tier credit cap banner (CRED-05) — v1.2

## Current Milestone: v2.0 TDD & Test Coverage

**Goal:** Backfill high test coverage across search & extraction, AI/LLM features, and user management — unit tests first, then integration — while establishing strict TDD as the standard for all future development.

**Target features:**
- Unit tests for all untested search/filter/export logic
- Unit tests for all untested AI prompt builders, batch processing, and utility functions
- Unit tests for auth state machine, plan enforcement, user creation, and feature flag guards
- Integration tests for critical cross-cutting flows
- TDD workflow documentation and patterns

### Active

(Defined in REQUIREMENTS.md)

### Out of Scope

- Adding new subscription tiers or changing pricing — pricing structure audit only
- Migrating away from `@convex-dev/stripe` — work within existing integration
- Stripe Connect or marketplace payments — not applicable
- Mobile payment flows (Apple Pay, Google Pay) — web-only
- Custom proration logic (bypass Stripe) — use Stripe's built-in proration
- Real-time credit deduction notifications — notification fatigue during batch AI operations
- Automating Stripe Checkout card entry — Stripe actively blocks automated testing of hosted checkout
- Automating Stripe Customer Portal UI — portal is a Stripe-hosted iframe
- Visual regression / screenshot tests — separate concern, notoriously flaky
- Recurring payment cycle credit grants E2E — requires Stripe test clocks, incompatible with browser checkout
- Payment failure E2E — requires Stripe Checkout iframe automation

## Context

Shipped v1.0 (38 files, +3181/-172, 29 commits), v1.1 (36 files, +4136/-210, 25 commits), and v1.2 (1,248 LOC TypeScript test infrastructure, 351 LOC CI YAML).
Tech stack: Next.js, Convex, Stripe SDK v20.3.0, `@convex-dev/stripe`, next-intl (6 locales), Playwright.
Key tables: `subscriptions`, `credits`, `creditTransactions`, `billingCustomers`, `stripeEventLogs`.
Test infrastructure: Vitest unit tests (43 files), backend live-billing integration tests, Playwright billing E2E suite (6 spec files, 11 tests).
CI pipeline: 3 billing jobs (billing-live, billing-live-extended, billing-nightly) run both Vitest + Playwright suites.
TOCTOU credit deduction race documented — mitigation triggers on observed incident in prod.

## Constraints

- **Platform**: All billing logic must run in Convex (actions/mutations) — no standalone API server
- **Existing component**: Must work with `@convex-dev/stripe` — don't bypass it unless necessary
- **Webhook-driven**: Stripe state changes must be driven by webhooks, not client-side polling
- **Idempotency**: All webhook handlers must be idempotent (events can be delivered multiple times)
- **Test isolation**: Each E2E test gets a fresh Clerk user — no shared state between tests

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
| Sonner toast for credit feedback | AppToastApi only exposes error methods | ✓ Good — direct sonner usage |
| Pin proration_date between preview and execution | Prevents charge drift from Stripe per-second proration | ✓ Good — exact match guaranteed |
| Tri-state toast (success/processing/error) | Server-reported creditsGranted drives feedback, never preview estimate | ✓ Good — no misleading UI |
| Webhook backup path for credit grants | Dual-path convergence with dedup ensures credits always granted | ✓ Good — resilient to action-path failures |
| Atomic metadata write on Stripe subscription | Webhook can classify proration invoices without local DB race | ✓ Good — eliminates stale data |
| Radix dismiss prevention for processing state | onEscapeKeyDown + onPointerDownOutside + onInteractOutside | ✓ Good — prevents accidental dismissal |
| HTML entities for card dots | Avoids Unicode bullet encoding issues across locales | ✓ Good — consistent rendering |
| Checkout-bypass pattern for E2E tests | Stripe blocks hosted checkout automation | ✓ Good — reliable, fast, deterministic |
| workers: 1 for billing tests | Clerk concurrent auth bug (#7891) | ✓ Good — eliminates flakes |
| WebhookWaiter polls Convex state | Eliminates timing flakes between Stripe webhook and UI | ✓ Good — deterministic assertions |
| Fresh Clerk user per test | Full isolation, no shared state contamination | ✓ Good — clean teardown |
| toBe() exact match for CRED-02 regression | Regression tests must catch any credit grant drift | ✓ Good — strict validation |
| CI credits env guard checks only "false" | Unset passes, matching runtime feature flag behavior | ✓ Good — consistent with app logic |

| Structural prompt testing (assert fields/markers, not AI quality) | Decouples test suite from AI model behavior; pure structural checks | ✓ Good — stable tests |
| .parse()/.safeParse() only for Zod testing | Avoids coupling to Zod internals (.shape, .element) | ✓ Good — version-stable |
| it.each parametric round-trip tests | Compact coverage across ASCII, Unicode, special chars | ✓ Good — readable, extensible |

---
*Last updated: 2026-02-28 after Phase 15*
