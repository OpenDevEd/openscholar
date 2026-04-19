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

// Daily sync of OpenRouter model catalog into models table
crons.interval(
  "sync openrouter models",
  { hours: 24 },
  internal.models.sync.syncFromOpenRouter
);

// Daily env var validation -- detects misconfiguration within 24h
crons.interval(
  "validate required env vars",
  { hours: 24 },
  internal.lib.envValidation.checkRequiredEnvVars
);

// Daily cleanup of completed extraction PDFs older than 30 days.
// The mutation paginates with take(500) + scheduler.runAfter(0) so a single
// tick drains the backlog safely regardless of size.
crons.interval(
  "cleanup old extraction pdfs",
  { hours: 24 },
  internal.extraction.mutations.internal.admin.cleanupOldPdfs,
  { maxAgeHours: 24 * 30 },
);

// 5-minute sweep of chat threads where a generate died mid-stream and
// left isGenerating === true. Safety net only — the action's try/finally
// clears the lock on every normal path.
crons.interval(
  "cleanup zombie chat locks",
  { minutes: 5 },
  internal.chat.concurrency.cleanupZombieChatLocks,
);

export default crons;
