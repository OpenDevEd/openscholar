# Stripe Billing Runbook

## Required Webhook Events

Configure the Stripe endpoint (`POST /webhooks/stripe`) with:

- `checkout.session.completed`
- `customer.created`
- `customer.updated`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.created`
- `invoice.finalized`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_succeeded`

## Local Development

Use the local Stripe listener:

```bash
npm run dev:stripe
```

This forwards webhook traffic to:

- `http://127.0.0.1:3211/webhooks/stripe`

## Plan-Change Conflict Policy

- Upgrades are immediate. If an attached schedule is `active` or `not_started`, release it first, then update the subscription with proration.
- Downgrades are period-end only. Phase 1 reuses the existing current phase boundaries; phase 2 starts exactly at current phase end.
- Same-tier requests with a pending scheduled change clear the pending schedule and keep the current plan.

## Monthly Credit Grant Policy

- Grant monthly credits only when `invoice.billing_reason` is one of:
  - `subscription_create`
  - `subscription_cycle`
- Ignore non-eligible invoice reasons (for example `subscription_update`, `manual`) and keep webhook idempotency keyed by `stripeInvoiceId`.
- Treat missing/unknown `billing_reason` on paid subscription invoices as configuration drift:
  - mark event as `failed`,
  - include actionable error context,
  - do not silently grant.

## Entitlement Policy

- `active`, `trialing`, `past_due` are entitled.
- `incomplete`, `incomplete_expired`, `unpaid`, `paused`, `canceled` are non-entitled.
- `incomplete` should be rendered as payment-pending in UI and routed to billing portal completion.

## Reconciliation Policy

- Webhook push path remains primary (`invoice.paid` / `invoice.payment_succeeded`).
- Pull-based reconciliation is enabled hourly via Convex cron:
  - internal action: `internal.credits.actions.reconcileRecentPaidInvoicesFromStripe`
- Reconciliation only backfills invoices that:
  - are paid,
  - are subscription-linked,
  - pass strict grant classification.

## Replay Procedure

1. Open Stripe Dashboard > Developers > Webhooks.
2. Select the relevant event delivery.
3. Click "Resend" for the event.
4. Verify the corresponding row in `stripeEventLogs` transitions from `received` to `processed`.
5. For invoice credit issues, confirm an idempotent grant row exists in `creditTransactions` with the same `stripeInvoiceId`.

## Event-Log Checklist

For any incident, inspect `stripeEventLogs` by `stripeEventId` and verify:

- `status` is `processed` for successful deliveries.
- `status` is `retrying` with a future `nextRetryAt` when deferred retries are scheduled.
- `status` is `failed` only after retry budget is exhausted.
- `attemptCount` increments for retries.
- `lastError` is populated for failed/retrying rows.
- non-eligible invoice grant attempts are logged as `ignored` (not granted).
- Reconciliation fallback rows use synthetic IDs in the format `invoice.reconcile:<stripeInvoiceId>`.

## Troubleshooting

1. `changePlan` failure during downgrade
- Inspect Stripe subscription schedule status and `current_phase` bounds.
- Confirm schedule updates do not mutate the current phase start date.

2. Unexpected plan switch after upgrade
- Confirm any `active`/`not_started` schedule was released before immediate upgrade.

3. Missing or extra monthly credits
- Verify `invoice.billing_reason` on the invoice event.
- Confirm matching `creditTransactions` idempotency row for `stripeInvoiceId`.
- Confirm non-eligible invoice events are `ignored` in `stripeEventLogs`.
- Confirm config-drift events are marked `failed` with remediation guidance.
- Confirm hourly reconcile job is running and creating `invoice.reconcile.pull:*` event-log rows.

## Rollout Verification Checklist

1. New user checkout creates a Stripe subscription and Convex `subscriptions` row.
2. Upgrades use the `changePlan` action and do not create duplicate Stripe subscriptions.
3. Downgrades schedule at period end and keep current plan until boundary.
4. `invoice.paid` grants credits exactly once per `stripeInvoiceId`.
5. Missing subscription races on `invoice.paid` show retry entries in `stripeEventLogs` and eventually grant.
6. `incomplete` and other non-entitled statuses (`unpaid`, `incomplete_expired`, `paused`) resolve to free entitlements in UI.
7. Hourly pull reconciliation backfills missed paid invoice grants without double-granting.
