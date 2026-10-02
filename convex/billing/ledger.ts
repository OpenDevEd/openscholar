/**
 * The usage ledger's bookkeeping, done in batches by one worker (`@convex-dev/batch-worker`),
 * as Firecrawl queues each billing operation and commits them per team from one batch
 * process. A settled charge appends its usage row and pings the queue; the worker counts
 * each batch into `usageAgg`, adds extraction job credits, and has each charged person's
 * account re-read from Autumn once per batch.
 */
import { defineBatchWorkerValidators, ping } from "@convex-dev/batch-worker";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { recordJobCredits } from "../extraction/aggregates";
import { requestRefresh } from "./accounts";
import { usageAgg, usageOps } from "./usageLog";

/** Charges per batch: a few aggregate entries and a job-credit entry each. */
const BATCH = 200;

const { vQueryArgs, vQueryReturns, vMutationArgs } = defineBatchWorkerValidators({
  batch: { charges: v.array(v.id("billingUsage")) },
});

/** Wakes the worker for charges just recorded. Costs a read while it's already running. */
export async function ledgerLater(ctx: MutationCtx) {
  await ping(ctx, components.batchWorker, {
    name: "billing",
    workQuery: internal.billing.ledger.nextCharges,
    workerMutation: internal.billing.ledger.record,
    config: { debounceMs: 500 },
  });
}

/**
 * The one way to add a charge row. It's appended in commit order and counted by
 * this worker, so charges settling together write nothing shared.
 */
export async function insertUsage(ctx: MutationCtx, row: Omit<Doc<"billingUsage">, "_id" | "_creationTime" | "queuedAt">) {
  const _id = await ctx.db.insert("billingUsage", { ...row, queuedAt: ctx.db.vars.commitTs });
  await ledgerLater(ctx);
  return _id;
}

const queuedAtOf = (row: Doc<"billingUsage">) => row.queuedAt as bigint | undefined;

/**
 * The next charges waiting to be counted, in commit order. The worker clears a charge's
 * `queuedAt` once it's counted, so the queue's index holds only waiting charges, and a scan
 * from the last commit picks up charges recorded in it that didn't fit the batch.
 */
export const nextCharges = internalQuery({
  args: vQueryArgs,
  returns: vQueryReturns,
  handler: async (ctx, { cursor }) => {
    const rows = await ctx.db
      .query("billingUsage")
      .withIndex("by_queuedAt", (q) => q.gte("queuedAt", cursor ?? 0n))
      .take(BATCH);
    const last = rows.length ? queuedAtOf(rows.at(-1)!) : undefined;
    if (last === undefined) return { kind: "idle" as const };
    return { kind: "work" as const, batch: { charges: rows.map((row) => row._id) }, cursor: last };
  },
});

/** Counts a batch of charges, adds job credits, and queues one refresh per person charged. */
export const record = internalMutation({
  args: vMutationArgs,
  handler: async (ctx, { charges: ids }) => {
    const rows = (await Promise.all(ids.map((id) => ctx.db.get("billingUsage", id)))).filter(
      (row): row is Doc<"billingUsage"> => row !== null && row.queuedAt !== undefined,
    );
    await usageAgg.enqueueBatch(ctx, rows.flatMap(usageOps));
    for (const row of rows) {
      // A job deleted since the charge has had its credits cleared; don't bring them back.
      if (row.jobId && (await ctx.db.get("extractionJobs", row.jobId))) {
        await recordJobCredits(ctx, { jobId: row.jobId, chargeId: row.chargeId, credits: row.credits });
      }
    }
    for (const userId of new Set<Id<"users">>(rows.map((row) => row.userId))) await requestRefresh(ctx, userId);
    // Counted: out of the queue.
    for (const row of rows) await ctx.db.patch("billingUsage", row._id, { queuedAt: undefined });
  },
});
