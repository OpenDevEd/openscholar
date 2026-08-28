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

export default crons;
