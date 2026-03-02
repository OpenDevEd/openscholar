import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily cleanup of soft-deleted users (after 30 days)
crons.interval(
  "cleanup deleted users",
  { hours: 24 },
  internal.maintenance.mutations.cleanupDeletedUsers
);

// Hourly subscription status check: corrective sync + past-due expiry
crons.interval(
  "check subscription status",
  { hours: 1 },
  internal.maintenance.internal.checkSubscriptionStatus
);

// Hourly monitoring for stale failed Stripe events (flag only, no auto-retry)
crons.interval(
  "monitor failed stripe events",
  { hours: 1 },
  internal.maintenance.mutations.monitorFailedStripeEvents
);

crons.interval(
  "reconcile stripe paid invoices",
  { hours: 1 },
  internal.credits.actions.reconcileRecentPaidInvoicesFromStripe,
  {},
);

export default crons;
