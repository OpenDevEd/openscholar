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

// Plans and features are edited in Autumn's dashboard, which sends no event
// for catalog changes, so the copy is re-read on a short interval.
crons.interval(
  "sync autumn billing catalog",
  { minutes: 5 },
  internal.billing.catalog.sync,
  {},
);

// A chat whose generation died without releasing its lock is released here (#355).
crons.interval(
  "release stale chat locks",
  { minutes: 5 },
  internal.chat.concurrency.cleanupZombieChatLocks,
  {},
);

// An assistant reply whose action died without releasing its chat is released here (#324).
crons.interval(
  "release dead assistant replies",
  { minutes: 5 },
  internal.assistant.replies.sweep,
  {},
);

export default crons;
