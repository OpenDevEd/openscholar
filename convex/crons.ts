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

// An assistant reply whose action died without releasing its chat is released here (#324).
crons.interval(
  "release dead assistant replies",
  { minutes: 5 },
  internal.assistant.replies.sweep,
  {},
);

// Files attached to assistant chats that no reply has read for 30 days, or that were never sent (#647).
crons.interval(
  "expire assistant chat files",
  { hours: 1 },
  internal.assistant.files.expire,
  {},
);

// Seats follow memberships as they change; this catches one an event missed (#652).
crons.interval(
  "sync team seats",
  { hours: 24 },
  internal.billing.seats.syncTeams,
  {},
);

export default crons;
