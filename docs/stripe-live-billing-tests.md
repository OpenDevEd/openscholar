# Stripe + Convex Live Billing Tests

This project now includes a remote live billing regression suite that runs against:

- Shared Convex dev deployment (no local Convex)
- Shared Stripe sandbox (no local Stripe)

## Suites

1. Required PR-gated suite (`tests/live-billing/required.test.ts`)
- Subscription happy path + one-time monthly grant
- Subscription recurrence at period boundary (test clock) + single renewal grant
- Invoice replay idempotency
- Credit top-up payment-intent idempotency
- Refund reversal replay safety

2. Extended non-blocking suite (`tests/live-billing/extended.test.ts`)
- Payment-failure non-entitled transition
- Upgrade immediate plan change + next-cycle upgraded grant amount
- Period-boundary downgrade with Stripe test clock
- Out-of-order/retry stress replay

## Commands

```bash
npm run test:billing:preflight
npm run test:billing:live
npm run test:billing:extended
```

CI wrappers (push Convex code before running):

```bash
npm run test:billing:live:ci
npm run test:billing:extended:ci
```

## Required Environment Variables

- `CONVEX_DEPLOYMENT` (or `CONVEX_DEPLOYMENT_NAME`)
- `NEXT_PUBLIC_CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_SITE_URL`)
- `STRIPE_SECRET_KEY`
- `STRIPE_GO_PRICE_ID`

Optional:

- `STRIPE_PRO_PRICE_ID` (needed for downgrade boundary extended test)
- `CREDITS_PER_USD`
- `BILLING_TEST_USER_SUBJECT`
- `BILLING_TEST_USER_EMAIL`
- `BILLING_LIVE_WEBHOOK_TIMEOUT_MS`

## Artifacts

Live suite output is written to:

- `test-results/billing-live/live.log`
- `test-results/billing-live/stripe-objects.json`
- `test-results/billing-live/*.json` snapshots per scenario

These files are uploaded in CI when the billing jobs run.
