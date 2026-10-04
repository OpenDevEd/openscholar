/**
 * Extraction's per-paper bookkeeping, done in batches by one worker
 * (`@convex-dev/batch-worker`), as Screen all's is (convex/screening/bookkeeping.ts). A
 * paper's run releases its own queue row, stamped `releasedAt`, and pings the queue. The
 * worker then, once per job in each batch, refills the job's window of running papers, and
 * when nothing is left to start checks whether the job is done. Papers finishing
 * together no longer each read and write their job's whole window, or its counters.
 */
import { defineBatchWorkerValidators } from "@convex-dev/batch-worker";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../../lib/functions";
import { getFlag } from "../../featureFlags/guard";
import {
  EXTRACTION_PAPER_CONCURRENCY,
  EXTRACTION_QUESTION_CONCURRENCY,
  EXTRACTION_QUEUE_LEASE_MS,
} from "../../../lib/extraction/limits";
import { extractionQueueStatusValidator } from "../validators";
import { dispatchPaperQueueWindowTx } from "./mutations";
import { release } from "./release";

/** Released rows per batch; each job in a batch is refilled once. */
const BATCH = 50;

const { vQueryArgs, vQueryReturns, vMutationArgs, vMutationReturns } = defineBatchWorkerValidators({
  batch: { rows: v.array(v.id("extractionPaperQueue")) },
});

const releasedAtOf = (row: Doc<"extractionPaperQueue">) => row.releasedAt as bigint | undefined;

/**
 * A paper's run is done with its row: sets its status and releases it to the worker,
 * which refills the job's window. Returns whether the row was still this run's.
 */
export const releasePaperQueueItem = internalMutation({
  args: {
    queueId: v.id("extractionPaperQueue"),
    expectedEpoch: v.number(),
    status: extractionQueueStatusValidator,
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, { queueId, expectedEpoch, status }) => {
    const row = await ctx.db.get(queueId);
    if (!row || row.runEpoch !== expectedEpoch) return { applied: false };
    // Marking its paper finished released it already (./release.ts).
    if (row.status === "completed" || row.status === "failed") return { applied: true };
    await release(ctx, row, status);
    return { applied: true };
  },
});

/**
 * The next released rows, in commit order. The worker clears a row's `releasedAt` once
 * handled, so the queue's index holds only waiting rows, and a scan from the last commit
 * picks up rows released in it that didn't fit the batch.
 */
export const nextReleased = internalQuery({
  args: vQueryArgs,
  returns: vQueryReturns,
  handler: async (ctx, { cursor }) => {
    const rows = await ctx.db
      .query("extractionPaperQueue")
      .withIndex("by_releasedAt", (q) => q.gte("releasedAt", cursor ?? 0n))
      .take(BATCH);
    const last = rows.length ? releasedAtOf(rows.at(-1)!) : undefined;
    if (last === undefined) return { kind: "idle" as const };
    return { kind: "work" as const, batch: { rows: rows.map((row) => row._id) }, cursor: last };
  },
});

/** Extraction job statuses whose papers are running. */
const RUNNING_JOB_STATUSES = ["downloading_pdfs", "indexing", "extracting"] as const;
/** A person's running jobs, of each status, one refill wakes. */
const JOBS_WOKEN = 20;

type PdfFlag = Awaited<ReturnType<typeof getFlag>>;

/** Starts papers in one job's window, as far as the person's limit allows. */
async function refillJob(ctx: MutationCtx, job: Doc<"extractionJobs">, pdfFlag: PdfFlag) {
  const epoch = job.runEpoch ?? 0;
  return await dispatchPaperQueueWindowTx(ctx, {
    jobId: job._id,
    expectedEpoch: epoch,
    paperConcurrency: EXTRACTION_PAPER_CONCURRENCY,
    leaseOwner: `refill:${job._id}:${epoch}`,
    leaseMs: EXTRACTION_QUEUE_LEASE_MS,
    questionConcurrency: EXTRACTION_QUESTION_CONCURRENCY,
    // As getJobAndFlagsInternal decides it: on unless the flag says off, and the job opted in.
    pdfEnabled: (pdfFlag?.enabled ?? true) && (job.usePdfs ?? false),
  });
}

/**
 * Starts the person's running jobs' papers in their free capacity, oldest job first, as
 * Firecrawl's `concurrentJobDone` promotes a team's queued work: a job held back by the
 * person's limit has no papers of its own finishing to wake it. Returns what each job got.
 */
export async function refillPerson(ctx: MutationCtx, userId: Id<"users">) {
  const pdfFlag = await getFlag(ctx, "extraction.pdf");
  const jobs = (
    await Promise.all(
      RUNNING_JOB_STATUSES.map((status) =>
        ctx.db.query("extractionJobs").withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status)).take(JOBS_WOKEN),
      ),
    )
  ).flat().sort((a, b) => a._creationTime - b._creationTime);
  const dispatched = new Map<Id<"extractionJobs">, number>();
  for (const job of jobs) {
    if (job.mode !== "extraction") continue;
    const window = await refillJob(ctx, job, pdfFlag);
    dispatched.set(job._id, window.dispatched);
    if (window.capacity === 0 && window.dispatched === 0) break;
  }
  return dispatched;
}

/** Wakes the person's held-back jobs after papers stopped holding capacity without a release. */
export const wakePerson = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await refillPerson(ctx, userId);
    return null;
  },
});

/** Refills the released rows' people, oldest job first, and finishes jobs with nothing left to run. */
export const refill = internalMutation({
  args: vMutationArgs,
  returns: vMutationReturns,
  handler: async (ctx, { rows: ids }) => {
    const rows = (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter(
      (row): row is Doc<"extractionPaperQueue"> => row !== null && row.releasedAt !== undefined,
    );
    const runs = new Map<string, { jobId: Id<"extractionJobs">; epoch: number }>();
    for (const row of rows) runs.set(`${row.jobId}:${row.runEpoch}`, { jobId: row.jobId, epoch: row.runEpoch });
    const people = new Map<Id<"users">, Array<{ jobId: Id<"extractionJobs">; epoch: number }>>();
    for (const run of runs.values()) {
      const job = await ctx.db.get(run.jobId);
      if (!job || (job.runEpoch ?? 0) !== run.epoch) continue;
      people.set(job.userId, [...(people.get(job.userId) ?? []), run]);
    }
    for (const [userId, released] of people) {
      // Freed capacity goes to the person's oldest job first, not back to the job that freed it.
      const dispatched = await refillPerson(ctx, userId);
      for (const { jobId, epoch } of released) {
        // Nothing left to start: whether the job is done is its counters' call, so a row whose
        // run stopped without releasing it can't hold the job open.
        if (!dispatched.get(jobId)) {
          await ctx.runMutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId, expectedEpoch: epoch });
        }
      }
    }
    // Handled: out of the queue.
    for (const row of rows) await ctx.db.patch(row._id, { releasedAt: undefined });
    return null;
  },
});
