/**
 * Job lifecycle mutations (public API).
 *
 * startJob / duplicateJob own the job-start path; cancelExtraction /
 * deleteExtraction own the terminal paths.
 * startJob schedules the app-owned paper queue setup action.
 */

import { mutation, type MutationCtx } from "../../lib/functions";
import { v, type ObjectType } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { extractionPricing, extractionStamp } from "../../ai/serverModel";
import { rateLimit } from "../../lib/rateLimit";
import { createError } from "../../lib/errors";
import { noteActivity } from "../../activity/notes";
import { assertBucketWithinLimits } from "../bucket/limits";
import { availableCredits as readAvailableCredits, planLimit } from "../../billing/accounts";
import { papersIn } from "../../screening/estimate";
import { dedupeBucketItems } from "../../../lib/bucket/dedupe";
import { assertValidJobTransition, type JobStatus } from "../stateMachine";
import {
  bucketItemInputValidator,
  questionInputValidator,
  MAX_QUESTIONS_PER_JOB,
  MAX_QUESTION_TEXT_LENGTH,
} from "../validators";
import { MAX_JOB_SOURCES, writeJobSources, type BucketItemInput } from "../jobSources";
import { extractionPaperCredits } from "../../../lib/pricing";
import { jobText } from "../../lib/searchText";
import { cancelPaperQueueRowsForJobTx } from "../queue/mutations";
import { refillWorkspace } from "../queue/dispatcher";
import { assistantMutation, defineUserMutation, userMutation } from "../../lib/userActions";
import { checkScreeningSelection } from "../sources/screening";
import { bucketItemFromRow } from "../jobSources";
import { actorIn, requireMakerOrAdmin, type InWorkspace } from "../../workspaces/actor";
import { paperPickValidator, sourcesFor, uploadPickValidator } from "../picks";

function deriveSourceType(
  items: ReadonlyArray<BucketItemInput>,
): "history" | "zotero" | "manual" | "screening" | "mixed" {
  const kinds = new Set<"history" | "zotero" | "manual" | "screening">();
  for (const item of items) {
    if (item.source === "history") kinds.add("history");
    else if (item.source === "zotero") kinds.add("zotero");
    else if (item.source === "screening") kinds.add("screening");
    else kinds.add("manual");
  }
  if (kinds.size >= 2) return "mixed";
  if (kinds.has("history")) return "history";
  if (kinds.has("zotero")) return "zotero";
  if (kinds.has("screening")) return "screening";
  return "manual";
}

const startArgs = {
  name: v.string(),
  bucketItems: v.array(bucketItemInputValidator),
  questions: v.optional(v.array(questionInputValidator)),
  usePdfs: v.optional(v.boolean()),
};

/**
 * Starts a job from its sources. `spend` is the hold of a job the person approved up to a
 * figure (#328), and that figure (../start.ts): the hold already has the credits, so the
 * balance isn't checked again, and the job's papers are charged under it.
 */
export async function startJobFor(ctx: MutationCtx, writer: InWorkspace, args: ObjectType<typeof startArgs>, spend?: { hold: string; cap: number }, chatStep?: Id<"assistantSteps">): Promise<{ jobId: Id<"extractionJobs"> }> {
  const { userId, workspaceId } = writer;
  await requireFeature(ctx, "extraction.enabled", userId);
  await requireFeature(ctx, "extraction.start", userId);
  await rateLimit(ctx, {
    name: "start-extraction",
    key: userId,
    throws: true,
  });

  // Shared: bucket validation + source persistence.
  const deduped = dedupeBucketItems(args.bucketItems.map(item => item.source === "screening" && item.screeningSelection
    ? { ...item, bucketKey: `screening:${item.screeningSelection.jobId}` }
    : item));
  for (const item of deduped) {
    if (item.source !== "screening") continue;
    if (!item.screeningSelection) {
      throw createError("VALIDATION_ERROR", "Select a screening job and its decision revision for extraction.");
    }
    const selection = item.screeningSelection;
    selection.count = await checkScreeningSelection(ctx, workspaceId, selection.jobId, selection.revision);
    item.sourceRefId = selection.jobId;
  }
  // A range of a collection or the library holds what the server counts in it now, never what it was sent.
  for (const item of deduped) {
    if (!item.librarySet) continue;
    const { collectionId, first, last } = item.librarySet;
    const held = await papersIn(ctx, writer, collectionId ? { kind: "collection", collectionId } : { kind: "saved" });
    if (held === null) throw createError("NOT_FOUND", "Collection not found");
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) throw createError("VALIDATION_ERROR", "Pick papers from 1 up, with the first before the last");
    item.librarySet = { ...item.librarySet, count: Math.max(0, Math.min(last, held) - first + 1) };
  }
  const bucketLimits = assertBucketWithinLimits(deduped, await planLimit(ctx, workspaceId, "request_papers"));
  const sourceType = deriveSourceType(deduped);

  // Stamp what extraction runs on (credits path), read back at run by paperWorker.
  const stamp = await extractionStamp(ctx, { userId, workspaceId });

  // Question validation happens after bucket validation so an empty bucket throws first.
  const qs = args.questions ?? [];
  if (qs.length > MAX_QUESTIONS_PER_JOB) {
    throw createError(
      "VALIDATION_ERROR",
      `questions exceeds maximum of ${MAX_QUESTIONS_PER_JOB}`,
    );
  }
  for (const q of qs) {
    if (q.question.length > MAX_QUESTION_TEXT_LENGTH) {
      throw createError(
        "VALIDATION_ERROR",
        `question text exceeds maximum length of ${MAX_QUESTION_TEXT_LENGTH}`,
      );
    }
  }

  // The most the job costs, on the models just stamped, against the balance: better to refuse
  // it now than stop it part way. A job with a hold has its credits already.
  if (!spend) {
    const credits = bucketLimits.effectiveCount * extractionPaperCredits(await extractionPricing(ctx, stamp), qs, args.usePdfs ?? false);
    const totalAvailable = await readAvailableCredits(ctx, workspaceId);
    if (totalAvailable < credits) {
      throw createError(
        "INSUFFICIENT_CREDITS",
        `Need up to ${credits} credits for ${bucketLimits.effectiveCount} papers × ${qs.length} questions but only have ${totalAvailable}`,
      );
    }
  }

  const now = Date.now();
  const jobId: Id<"extractionJobs"> = await ctx.db.insert("extractionJobs", {
    workspaceId,
    createdBy: userId,
    name: args.name,
    searchText: jobText({ name: args.name }),
    sourceType,
    createdAt: now,
    updatedAt: now,
    status: "pending",
    totalPapers: 0,
    runEpoch: 0,
    // Its setup reads its sources from the first (../actions.ts).
    setup: { position: 0, read: 0, papers: 0, processable: 0 },
    usePdfs: args.usePdfs ?? false,
    ...stamp,
    ...(spend ? { spendHold: spend.hold, spendCap: spend.cap } : {}),
    ...(chatStep ? { chatStep } : {}),
  });

  await writeJobSources(ctx, jobId, deduped);

  for (let i = 0; i < qs.length; i++) {
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: qs[i].key,
      question: qs[i].question,
      type: qs[i].type,
      description: qs[i].description,
      order: i,
      createdAt: now,
    });
  }

  await ctx.scheduler.runAfter(
    0,
    internal.extraction.actions.setupExtractionQueueJob,
    { jobId, expectedEpoch: 0 },
  );

  return { jobId };
}

export const startJobAction = defineUserMutation({
  path: "extraction/mutations:startJob",
  activity: ({ name }, { jobId }) => ({ kind: "extraction", id: jobId, happened: "created", detail: name }),
  description:
    "Start an extraction from the sources picked on the extraction page, any number of them: each a paper set (a saved search, a collection, the saved papers, or a finished screening) with its papers `first` to `last`, and PDFs the person uploaded. " +
    "From a chat, an extraction over one set is extraction/start:extract. A screening is its Included papers as they are now; later screening edits leave the extraction as it is. The person's plan sets how many papers one job takes.",
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  args: { name: v.string(), sources: v.array(paperPickValidator), uploads: v.optional(v.array(uploadPickValidator)), questions: v.optional(v.array(questionInputValidator)), usePdfs: v.optional(v.boolean()) },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  run: async (ctx, { userId, workspaceId }, { sources, uploads, ...args }) => startJobFor(ctx, { userId, workspaceId }, { ...args, bucketItems: await sourcesFor(ctx, { userId, workspaceId }, sources, uploads) }),
});

export const startJob = userMutation(startJobAction);
export const startJobForAssistant = assistantMutation(startJobAction);

export const duplicateJobAction = defineUserMutation({
  path: "extraction/mutations:duplicateJob",
  activity: (_args, { jobId }) => ({ kind: "extraction", id: jobId, happened: "created" }),
  description: "Duplicate a job's questions and sources. Screening sources must still have the saved decision revision; if decisions changed, select the screening again in a new extraction.",
  spendsCredits: true,
  outsideEffect: false,
  undoable: false,
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ jobId: v.id("extractionJobs") }),
  run: async (ctx, { userId, workspaceId }, args): Promise<{ jobId: Id<"extractionJobs"> }> => {
    await requireFeature(ctx, "extraction.enabled", userId);

    const oldJob = await ctx.db.get("extractionJobs", args.jobId);
    // The copy is made in the workspace the call acts in, which the original must be in.
    if (!oldJob || !(oldJob.workspaceId === workspaceId)) {
      throw createError("NOT_FOUND", "Job not found");
    }

    await requireFeature(ctx, "extraction.start", userId);
    await rateLimit(ctx, {
      name: "start-extraction",
      key: userId,
      throws: true,
    });

    // Old source rows in position order.
    const oldSourceRows = await ctx.db
      .query("extractionJobSources")
      .withIndex("by_job_and_position", (q) => q.eq("jobId", args.jobId))
      .take(MAX_JOB_SOURCES);
    const bucketItems = oldSourceRows.map(bucketItemFromRow);
    for (const item of bucketItems) {
      if (item.source === "screening" && item.screeningSelection) await checkScreeningSelection(ctx, workspaceId, item.screeningSelection.jobId, item.screeningSelection.revision);
    }
    assertBucketWithinLimits(bucketItems, await planLimit(ctx, workspaceId, "request_papers"));

    const now = Date.now();

    const questions = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(MAX_QUESTIONS_PER_JOB);

    const dupStamp = await extractionStamp(ctx, { userId, workspaceId });
    const newJobId = await ctx.db.insert("extractionJobs", {
      workspaceId,
      createdBy: userId,
      name: `${oldJob.name} (Copy)`,
      searchText: jobText({ name: `${oldJob.name} (Copy)` }),
      sourceType: oldJob.sourceType,
      status: "pending",
      totalPapers: 0,
      runEpoch: 0,
      setup: { position: 0, read: 0, papers: 0, processable: 0 },
      usePdfs: oldJob.usePdfs ?? false,
      ...dupStamp,
      createdAt: now,
      updatedAt: now,
    });

    await writeJobSources(ctx, newJobId, bucketItems);

    for (const q of questions) {
      await ctx.db.insert("extractionQuestions", {
        jobId: newJobId,
        key: q.key,
        question: q.question,
        type: q.type,
        description: q.description,
        order: q.order,
        createdAt: now,
      });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.extraction.actions.setupExtractionQueueJob,
      { jobId: newJobId, expectedEpoch: 0 },
    );

    return { jobId: newJobId };
  },
});

export const duplicateJob = userMutation(duplicateJobAction);
export const duplicateJobForAssistant = assistantMutation(duplicateJobAction);

export const cancelExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get("extractionJobs", args.jobId);
    const actor = job && (await actorIn(ctx, user, job.workspaceId));
    if (!job || !actor) {
      throw createError("NOT_FOUND", "Job not found");
    }
    requireMakerOrAdmin(actor, job.createdBy);

    if (
      job.status &&
      ["completed", "failed", "cancelled"].includes(job.status)
    ) {
      return { success: true };
    }

    assertValidJobTransition(job.status as JobStatus, "cancelled");
    await ctx.db.patch("extractionJobs", args.jobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    await cancelPaperQueueRowsForJobTx(ctx, { jobId: args.jobId });
    // Its papers no longer count against the person's limit; their other jobs start in it.
    await refillWorkspace(ctx, job.workspaceId);
    await noteActivity(ctx, { workspaceId: job.workspaceId, by: user._id, viaAssistant: false }, { kind: "extraction", id: args.jobId, happened: "stopped" });

    // Any in-flight paper action sees the cancelled job on its next
    // status check and returns without persisting.
    return { success: true };
  },
});

export const deleteExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const job = await ctx.db.get("extractionJobs", args.jobId);
    const actor = job && (await actorIn(ctx, user, job.workspaceId));
    if (!job || !actor) {
      throw createError("NOT_FOUND", "Job not found");
    }
    requireMakerOrAdmin(actor, job.createdBy);

    await ctx.db.delete(args.jobId);
    // Its papers stop holding the person's capacity now, not when the cascade reaches them.
    await cancelPaperQueueRowsForJobTx(ctx, { jobId: args.jobId });
    await refillWorkspace(ctx, job.workspaceId);

    // Schedule the cascade delete as an independent mutation to avoid
    // transaction limits on a large job's child tables.
    await ctx.scheduler.runAfter(
      0,
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId: args.jobId },
    );

    return null;
  },
});
