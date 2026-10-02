/**
 * Releasing extraction queue rows to the extraction worker (./dispatcher.ts). Kept apart
 * from the worker so the paper lifecycle can release rows without loading it.
 */
import { ping } from "@convex-dev/batch-worker";
import { components, internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

/** Wakes the worker for rows just released. Costs a read while it's already running. */
async function refillLater(ctx: MutationCtx) {
  await ping(ctx, components.batchWorker, {
    name: "extraction",
    workQuery: internal.extraction.queue.dispatcher.nextReleased,
    workerMutation: internal.extraction.queue.dispatcher.refill,
    // Each released row is an idle slot; refill promptly.
    config: { debounceMs: 50 },
  });
}

/** Sets a row's status, clears its lease, and hands it to the worker. */
export async function release(ctx: MutationCtx, row: Doc<"extractionPaperQueue">, status: Doc<"extractionPaperQueue">["status"]) {
  await ctx.db.patch(row._id, {
    status,
    leaseOwner: undefined,
    leasedAt: undefined,
    leaseExpiresAt: undefined,
    releasedAt: ctx.db.vars.commitTs,
    updatedAt: Date.now(),
  });
  await refillLater(ctx);
}

/**
 * Releases a paper's running rows as the paper finishes, in the same transaction, so a run
 * that stops after finishing its paper still hands its slot back and lets the job finish.
 */
export async function releaseRowsForPaperTx(ctx: MutationCtx, paperId: Id<"extractionPapers">) {
  const rows = await ctx.db
    .query("extractionPaperQueue")
    .withIndex("by_paper_and_epoch_and_kind", (q) => q.eq("paperId", paperId))
    .take(20);
  for (const row of rows) if (row.status === "leased" || row.status === "running") await release(ctx, row, "completed");
}

