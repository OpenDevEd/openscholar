import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily cleanup of soft-deleted users (after 30 days)
crons.interval(
  "cleanup deleted users",
  { hours: 24 },
  internal.maintenance.internal.cleanupDeletedUsers
);

// Hourly usage stats aggregation
crons.interval(
  "aggregate usage stats",
  { hours: 1 },
  internal.maintenance.internal.aggregateUsage
);

// Monthly credit expiry check (1st of each month at midnight)
crons.cron(
  "check credit expiry",
  "0 0 1 * *",
  internal.maintenance.internal.checkCreditExpiry
);

// Daily subscription status check
crons.interval(
  "check subscription status",
  { hours: 24 },
  internal.maintenance.internal.checkSubscriptionStatus
);

export default crons;
