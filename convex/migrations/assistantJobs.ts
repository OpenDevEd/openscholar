import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalMutation } from "../lib/functions";
import { noteRunningJob } from "../assistant/jobEnds";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Writes the running rows (assistant/jobEnds.ts) of jobs replies started that were already
// running when the rows began to be kept, so their chats dock them. Safe to repeat: a job that
// has its row, or doesn't run, is left alone.
export const screenings = migrations.define({ table: "screeningJobs", migrateOne: (ctx, job) => noteRunningJob(ctx, "screening", job) });
export const extractions = migrations.define({ table: "extractionJobs", migrateOne: (ctx, job) => noteRunningJob(ctx, "extraction", job) });

export const run = migrations.runner([internal.migrations.assistantJobs.screenings, internal.migrations.assistantJobs.extractions]);
