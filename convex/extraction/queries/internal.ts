/**
 * Internal queries used by queue / workpool / cron handlers. Every
 * export here is an `internalQuery`; public readers live in the sibling
 * submodules. Gathering them in one file makes the internal surface
 * obvious at a glance and cheap to audit.
 *
 * Names intentionally keep the `*Internal` suffix for the non-debug
 * internals; after T5.13 they surface at
 * `internal.extraction.queries.internal.<fn>` and the suffix is
 * redundant, but renaming them would fan out across workpoolActions.ts
 * without adding value.
 */

import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { getFlag } from "../../featureFlags/guard";
import { holdOpen } from "../../billing/spend";
import { userValidator } from "../../lib/validators";
import { getProcessableFlags } from "../content";
import { bucketItemFromRow } from "../jobSources";
import { MAX_EVIDENCE_UNITS_PER_PAPER } from "../../lib/queryBounds";
import { creditsAgg } from "../aggregates";
import {
  errorCodeValidator,
  extractionEvidenceUnitValidator,
  extractionJobValidator,
  extractionPaperValidator,
  extractionQuestionValidator,
  extractionResultValidator,
  storedBucketItemValidator,
  jobStatusValidator,
  paperStatusValidator,
} from "../validators";
import { MAX_QUESTIONS_PER_JOB } from "../validators";
import { personalWorkspaceOf } from "../../workspaces/actor";
import { extractionPricing } from "../../ai/serverModel";
import { extractionPaperCredits } from "../../../lib/pricing";

export const getJobInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.union(v.null(), extractionJobValidator),
  handler: async (ctx, args) => {
    return await ctx.db.get("extractionJobs", args.jobId);
  },
});

/**
 * What a job approved up to a figure checks before it reads another paper (../paperWorker.ts):
 * whether its hold still takes items, and what the ledger has counted of the job so far.
 */
export const approvalOf = internalQuery({
  args: { jobId: v.id("extractionJobs"), hold: v.string() },
  returns: v.object({ open: v.boolean(), spent: v.number() }),
  handler: async (ctx, { jobId, hold }) => {
    return { open: await holdOpen(ctx, hold), spent: await creditsAgg.sum(ctx, { namespace: jobId }) };
  },
});

/**
 * What a paper of a job holds before it runs (../paperWorker.ts): its questions, or the ones a
 * retry asks again, on the models the job was stamped with, and how many there are.
 */
export const paperCredits = internalQuery({
  args: { jobId: v.id("extractionJobs"), questionKeys: v.optional(v.array(v.string())), pdf: v.boolean() },
  returns: v.object({ credits: v.number(), questions: v.number() }),
  handler: async (ctx, { jobId, questionKeys, pdf }) => {
    const job = await ctx.db.get("extractionJobs", jobId);
    if (!job) return { credits: 0, questions: 0 };
    const all = await ctx.db
      .query("extractionQuestions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(MAX_QUESTIONS_PER_JOB);
    // A retry asks some of them again, of a paper already read.
    const asked = questionKeys ? all.filter((question) => questionKeys.includes(question.key)) : all;
    return { credits: extractionPaperCredits(await extractionPricing(ctx, job), asked, pdf, pdf && !questionKeys), questions: asked.length };
  },
});

/**
 * Lean control-plane read used by queue dispatchers and worker stale-run
 * guards. Returning just `{ status, runEpoch }` keeps the freshness read
 * cheap enough to repeat before dispatch and before persistence.
 */
export const getJobStatusInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    status: v.union(v.null(), jobStatusValidator),
    runEpoch: v.number(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("extractionJobs", args.jobId);
    return {
      status: job?.status ?? null,
      runEpoch: job?.runEpoch ?? 0,
    };
  },
});

/** Sources one setup step reads at most. */
const SOURCES_A_STEP = 100;

/** A job's sources from `position` on, at most `numItems` of them, each with its position: what one setup step reads (../actions.ts). */
export const jobSourcesFrom = internalQuery({
  args: { jobId: v.id("extractionJobs"), position: v.number(), numItems: v.number() },
  returns: v.array(v.object({ position: v.number(), item: storedBucketItemValidator })),
  handler: async (ctx, { jobId, position, numItems }) => {
    const rows = await ctx.db
      .query("extractionJobSources")
      .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId).gte("position", position))
      .take(Math.min(numItems, SOURCES_A_STEP));
    return rows.map((row) => ({ position: row.position, item: bucketItemFromRow(row) }));
  },
});

// Combined read so workpool actions fetch job + effective pdfEnabled in
// one round trip. `pdfEnabled` is the EFFECTIVE flag: both the admin
// capability gate (`extraction.pdf`) AND the per-job opt-in
// (`job.usePdfs`) must be true. This keeps the AND logic in one place
// so every caller stays consistent.
export const getJobAndFlagsInternal = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    job: v.union(v.null(), extractionJobValidator),
    pdfEnabled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const [job, pdfFlag] = await Promise.all([
      ctx.db.get("extractionJobs", args.jobId),
      getFlag(ctx, "extraction.pdf"),
    ]);
    const flagOn = pdfFlag?.enabled ?? true;
    const jobOptedIn = job?.usePdfs ?? false;
    return {
      job,
      pdfEnabled: flagOn && jobOptedIn,
    };
  },
});

export const getPaperExtractionContext = internalQuery({
  args: {
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
  },
  returns: v.union(
    v.object({ status: v.literal("not_found") }),
    v.object({
      status: v.literal("ok"),
      job: extractionJobValidator,
      paper: extractionPaperValidator,
      user: v.union(v.null(), userValidator),
      pdfEnabled: v.boolean(),
      questions: v.array(extractionQuestionValidator),
      results: v.array(extractionResultValidator),
      evidenceUnits: v.array(extractionEvidenceUnitValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const [job, paper, pdfFlag] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.paperId),
      getFlag(ctx, "extraction.pdf"),
    ]);
    if (!job || !paper || paper.jobId !== args.jobId) {
      return { status: "not_found" as const };
    }

    const [user, questions, results, evidenceUnits] = await Promise.all([
      ctx.db.get("users", job.createdBy),
      ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
        .order("asc")
        .take(MAX_QUESTIONS_PER_JOB),
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
        .take(MAX_QUESTIONS_PER_JOB),
      ctx.db
        .query("extractionEvidenceUnits")
        .withIndex("by_paper", (q) => q.eq("paperId", args.paperId))
        .take(MAX_EVIDENCE_UNITS_PER_PAPER),
    ]);

    return {
      status: "ok" as const,
      job,
      paper,
      user,
      pdfEnabled: (pdfFlag?.enabled ?? true) && (job.usePdfs ?? false),
      questions,
      results,
      evidenceUnits,
    };
  },
});


export const debugRecentPapers = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("extractionPapers"),
      title: v.string(),
      status: paperStatusValidator,
      pdfUrl: v.boolean(),
      storageId: v.optional(v.id("_storage")),
      ragEntryId: v.optional(v.string()),
      lastErrorCode: v.optional(errorCodeValidator),
      lastErrorMessage: v.optional(v.string()),
      attemptCount: v.optional(v.number()),
      completedAt: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const papers = await ctx.db
      .query("extractionPapers")
      .order("desc")
      .take(10);

    return papers.map((p) => ({
      id: p._id,
      title: p.title.substring(0, 30),
      status: p.status,
      pdfUrl: !!p.pdfUrl,
      storageId: p.storageId,
      ragEntryId: p.ragEntryId,
      lastErrorCode: p.lastError?.code,
      lastErrorMessage: p.lastError?.message,
      attemptCount: p.attemptCount,
      completedAt: p.completedAt
        ? new Date(p.completedAt).toISOString()
        : null,
    }));
  },
});


/** Library papers one `ownedLibraryItems` read takes. */
export const LIBRARY_READ_BATCH = 100;

/** A library paper's fields a job's library and collection sources read. */
const libraryPaperValidator = v.object({
  _id: v.id("libraryItems"),
  title: v.string(),
  authors: v.optional(v.array(v.string())),
  authorsUnparsed: v.optional(v.string()),
  isOpenAccess: v.optional(v.boolean()),
  oaStatus: v.optional(v.string()),
  oaUrl: v.optional(v.string()),
  pdfUrl: v.optional(v.string()),
  doi: v.optional(v.string()),
  openalexId: v.string(),
  abstract: v.optional(v.string()),
  publicationYear: v.optional(v.number()),
  journal: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
  workType: v.optional(v.string()),
});

/**
 * The person's own library papers among these ids (#341): a job reads its library and
 * collection sources from here, not from the copy the browser sent. Papers that are gone
 * or someone else's are left out.
 */
export const ownedLibraryItems = internalQuery({
  // `workspaceId` is optional only for a call from an action already running when this deployed (#650), which reads its person's own; required again in slice 8.
  args: { userId: v.id("users"), workspaceId: v.optional(v.id("workspaces")), ids: v.array(v.string()) },
  returns: v.array(libraryPaperValidator),
  handler: async (ctx, { userId, workspaceId: given, ids }) => {
    // A library row holds its paper's full JSON, so a read is bounded by count, well under
    // Convex's 16 MiB a transaction: callers read a job's papers in batches of this size.
    if (ids.length > LIBRARY_READ_BATCH) throw new Error(`Read at most ${LIBRARY_READ_BATCH} library papers at a time`);
    // Papers in the job's workspace, which the caller names.
    const workspaceId = given ?? (await personalWorkspaceOf(ctx, userId));
    const rows = await Promise.all(
      ids.map((id) => {
        const itemId = ctx.db.normalizeId("libraryItems", id);
        return itemId ? ctx.db.get("libraryItems", itemId) : null;
      }),
    );
    return rows.flatMap((row) =>
      row && row.workspaceId === workspaceId
        ? [{
            _id: row._id, title: row.title, authors: row.authors, doi: row.doi, openalexId: row.openalexId, abstract: row.abstract,
            publicationYear: row.publicationYear, journal: row.journal, citedByCount: row.citedByCount, workType: row.workType,
            authorsUnparsed: row.authorsUnparsed, isOpenAccess: row.isOpenAccess, oaStatus: row.oaStatus, oaUrl: row.oaUrl, pdfUrl: row.pdfUrl,
          }]
        : [],
    );
  },
});
