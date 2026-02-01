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

// Daily subscription status check
crons.interval(
  "check subscription status",
  { hours: 24 },
  internal.maintenance.internal.checkSubscriptionStatus
);

// Process papers for active extraction jobs every 30 seconds
crons.interval(
  "process extraction papers",
  { seconds: 30 },
  internal.extraction.mutations.updateAllJobProgress
);

export default crons;
