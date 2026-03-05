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
  internal.maintenance.internal.checkSubscriptionStatus,
  {},
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

// Hourly cleanup of expired Zotero OAuth request tokens
crons.interval(
  "cleanup expired zotero oauth tokens",
  { hours: 1 },
  internal.zotero.mutations.cleanupExpiredOAuthTokens
);

// Daily env var validation -- detects misconfiguration within 24h
crons.interval(
  "validate required env vars",
  { hours: 24 },
  internal.lib.envValidation.checkRequiredEnvVars
);

export default crons;
