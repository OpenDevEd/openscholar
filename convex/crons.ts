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

// Hourly RAG cleanup - delete old replaced entries to prevent database bloat
crons.interval(
  "cleanup old RAG entries",
  { hours: 1 },
  internal.rag.actions.cleanupOldRagEntriesAction,
  {}
);

// Job system watchdog - recover stuck jobs and start pending dependencies
crons.interval(
  "job system watchdog",
  { minutes: 1 },
  internal.jobs.watchdog.watchdog
);

export default crons;
