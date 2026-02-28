# OpenAlex Count — Stripe Integration Audit

## What This Is

A comprehensive audit and fix of the Stripe billing integration in OpenAlex Count, an academic literature search and extraction tool built with Next.js + Convex. Subscription plans, credit purchasing, upgrade flows, and webhook handling have been verified, corrected, and hardened to match industry best practices — including a reliable upgrade flow with proration preview, dual-path credit grants, and a polished confirmation dialog.

## Core Value

Every billing operation (subscribe, upgrade, downgrade, cancel, purchase credits) must produce correct financial outcomes — the right amount charged, at the right time, with proper proration and user feedback.

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

### Active

- [ ] Full browser E2E test suite for all Stripe billing flows (Playwright + Clerk test mode + Stripe sandbox + Convex dev)
- [ ] Test coverage: subscription, upgrade, downgrade, cancellation, credit granting (sub + upgrade), recurring payment credit grants, credit topup, free credit capping
- [ ] Fresh Clerk test user per test for isolation
- [ ] Proper test infrastructure: fixtures, utilities, cleanup

## Current Milestone: v1.2 E2E Billing Tests

**Goal:** Comprehensive Playwright E2E tests exercising every billing flow through the actual UI against Clerk test mode, Stripe sandbox, and Convex dev backend.

**Target features:**
- Subscription E2E (free → Go, free → Pro via UI checkout)
- Upgrade E2E (Go → Pro via upgrade dialog with proration preview)
- Downgrade E2E (Pro → Go via customer portal or UI)
- Cancellation E2E
- Credit granting verification (on subscribe, on upgrade pro-rata)
- Recurring payment cycle credit grants
- Credit topup purchase flow
- Free credit capping behavior
- Fresh test user isolation per scenario

### Out of Scope

- Adding new subscription tiers or changing pricing — pricing structure audit only
- Migrating away from `@convex-dev/stripe` — work within existing integration
- Stripe Connect or marketplace payments — not applicable
- Mobile payment flows (Apple Pay, Google Pay) — web-only
- Custom proration logic (bypass Stripe) — use Stripe's built-in proration
- Real-time credit deduction notifications — notification fatigue during batch AI operations

## Context

Shipped v1.0 (38 files, +3181/-172, 29 commits) and v1.1 (36 files, +4136/-210, 25 commits).
Tech stack: Next.js, Convex, Stripe SDK v20.3.0, `@convex-dev/stripe`, next-intl (6 locales).
Key tables: `subscriptions`, `credits`, `creditTransactions`, `billingCustomers`, `stripeEventLogs`.
Upgrade flow fully operational: proration preview, dual-path credit grants (action + webhook), confirmation dialog with payment method, line items, and dismiss guard.
TOCTOU credit deduction race documented — mitigation triggers on observed incident in prod.
9 human verification items pending Stripe test mode validation across v1.1 phases.
Existing test infrastructure: Vitest unit tests (43 files), backend live-billing integration tests (Stripe test clocks + Convex CLI), Playwright E2E auth spec with Clerk test mode.
Test environment: local Next.js dev server + deployed Convex dev instance + Stripe sandbox + Clerk test mode.

## Constraints

- **Platform**: All billing logic must run in Convex (actions/mutations) — no standalone API server
- **Existing component**: Must work with `@convex-dev/stripe` — don't bypass it unless necessary
- **Webhook-driven**: Stripe state changes must be driven by webhooks, not client-side polling
- **Idempotency**: All webhook handlers must be idempotent (events can be delivered multiple times)

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

---
*Last updated: 2026-02-28 after v1.2 milestone started*
