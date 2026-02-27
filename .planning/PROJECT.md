# OpenAlex Count — Stripe Integration Audit

## What This Is

A comprehensive audit and fix of the Stripe billing integration in OpenAlex Count, an academic literature search and extraction tool built with Next.js + Convex. The app has subscription plans, credit purchasing, and webhook handling — all of which need to be verified, corrected, and hardened to match industry best practices.

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

### Active

- [ ] Upgrade flow charges the proration difference immediately (not just switching plans silently)
- [ ] Downgrade takes effect at end of billing period (not immediately)
- [ ] Credit purchase flow is correct end-to-end (payment → credit grant → UI update)
- [ ] Webhook handler covers all critical Stripe events with correct logic
- [ ] Subscription cancellation flow follows best practices
- [ ] Error handling for failed payments, declined cards, and edge cases
- [ ] Idempotency and race condition protection across all billing operations
- [ ] Invoice reconciliation cron job is correct and handles edge cases

### Out of Scope

- Adding new subscription tiers or changing pricing — pricing structure audit only
- Migrating away from `@convex-dev/stripe` — work within existing integration
- Stripe Connect or marketplace payments — not applicable
- Mobile payment flows (Apple Pay, Google Pay) — web-only

## Context

- Backend is Convex (serverless, event-driven) — all Stripe logic runs as Convex actions/mutations
- Uses `@convex-dev/stripe` component for webhook registration and subscription state
- Stripe SDK v20.3.0 — latest API features available
- Key tables: `subscriptions`, `credits`, `creditTransactions`, `billingCustomers`, `stripeEventLogs`
- Known bug: upgrading just switches the plan without charging the proration difference
- Credit system: users get monthly credits from subscription + can buy credit packs
- Dual AI mode: credits-based (server) vs BYOK (client) — credits are consumed by server-side AI operations

## Constraints

- **Platform**: All billing logic must run in Convex (actions/mutations) — no standalone API server
- **Existing component**: Must work with `@convex-dev/stripe` — don't bypass it unless necessary
- **Webhook-driven**: Stripe state changes must be driven by webhooks, not client-side polling
- **Idempotency**: All webhook handlers must be idempotent (events can be delivered multiple times)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Upgrade = immediate proration charge | Industry standard; users expect to pay difference now | — Pending |
| Downgrade = end of billing period | Users keep what they paid for; standard practice | — Pending |
| Work within @convex-dev/stripe | Existing integration, no need to replace | — Pending |

---
*Last updated: 2026-02-27 after initialization*
