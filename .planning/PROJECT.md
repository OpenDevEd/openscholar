# OpenAlex Count — Stripe Integration Audit

## What This Is

A comprehensive audit and fix of the Stripe billing integration in OpenAlex Count, an academic literature search and extraction tool built with Next.js + Convex. Subscription plans, credit purchasing, and webhook handling have been verified, corrected, and hardened to match industry best practices.

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

### Active

- [ ] Reliable upgrade flow: charge, sync plan, and grant credits atomically
- [ ] Proration preview dialog before confirming upgrade
- [ ] Pro-rata credit grants on mid-cycle upgrades
- [ ] Upgrade error handling that never leaves user in broken state

### Out of Scope

- Adding new subscription tiers or changing pricing — pricing structure audit only
- Migrating away from `@convex-dev/stripe` — work within existing integration
- Stripe Connect or marketplace payments — not applicable
- Mobile payment flows (Apple Pay, Google Pay) — web-only
- Custom proration logic (bypass Stripe) — use Stripe's built-in proration
- Real-time credit deduction notifications — notification fatigue during batch AI operations

## Context

Shipped v1.0 with 38 files changed, +3181/-172 lines across 29 commits.
Tech stack: Next.js, Convex, Stripe SDK v20.3.0, `@convex-dev/stripe`.
Key tables: `subscriptions`, `credits`, `creditTransactions`, `billingCustomers`, `stripeEventLogs`.
Known issue: upgrade flow broken in production — plan changes but errors and doesn't grant credits. Existing uncommitted attempt at fix (confirmation dialog, pro-rata credits) needs to be scrapped and redone properly.
TOCTOU credit deduction race documented — mitigation triggers on observed incident in prod.

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

## Current Milestone: v1.1 Upgrade Flow

**Goal:** Fix the broken upgrade flow so it reliably charges, syncs, and grants credits — with a confirmation dialog so users know what they're paying before committing.

**Target features:**
- Proration preview dialog before upgrade
- Reliable pro-rata credit grants on upgrade
- Error handling that keeps user state consistent
- Clear feedback on success/failure

---
*Last updated: 2026-02-27 after v1.1 milestone started*
