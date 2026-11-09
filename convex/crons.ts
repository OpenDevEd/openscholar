import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The public directory's record counts (#1090): an import runs inside the community, which doesn't tell us.
crons.interval(
  "refresh community record counts",
  { hours: 24 },
  internal.evidenceLibraries.directory.refreshAllRecords,
  {},
);

// Custom domains that stop pointing at us should stop showing as working.
crons.interval(
  "recheck evidence library custom domains",
  { hours: 6 },
  internal.evidenceLibraries.domainActions.sweepWorkingDomains,
  {},
);

// What the community releases page lists. new-el publishes without telling us.
crons.interval(
  "sync community releases",
  { minutes: 10 },
  internal.evidenceLibraries.releases.syncCatalog,
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

// The privacy policy says a deleted account's data goes within about 30 days.
crons.interval(
  "clean up deleted users",
  { hours: 24 },
  internal.maintenance.mutations.cleanupDeletedUsers,
  {},
);

export default crons;
