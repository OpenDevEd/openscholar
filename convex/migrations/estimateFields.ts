import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Clears what jobs kept of the old fixed-rate estimates: the page's figure and the price scale a
// chat-started job's papers were held at. Both are worked out from the job's models now
// (lib/pricing/estimate.ts). Safe to repeat.
export const jobs = migrations.define({
  table: "extractionJobs",
  migrateOne: (_ctx, job) => (job.estimatedCredits !== undefined || job.spendScale !== undefined ? { estimatedCredits: undefined, spendScale: undefined } : undefined),
});

export const run = migrations.runner(internal.migrations.estimateFields.jobs);
