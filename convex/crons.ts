import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Custom domains that stop pointing at us should stop showing as working.
crons.interval(
  "recheck evidence library custom domains",
  { hours: 6 },
  internal.evidenceLibraries.domainActions.sweepWorkingDomains,
  {},
);

// Convex allows only one executing run of this cron. The action never
// schedules a continuation; a failed run waits for the next daily tick.
crons.interval(
  "sync openrouter models",
  { hours: 24 },
  internal.models.sync.syncFromOpenRouter,
  {},
);

export default crons;
