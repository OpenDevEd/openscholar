/**
 * ChatPapers query + mutation surface (plan-03).
 *
 * Three entry points the UI consumes:
 *   - `listChatSourcesWithInclusion(jobId)` — reactive query joining
 *     `extractionJobSources` and `chatPapers`, sorted by position.
 *   - `toggleChatPaper(chatPaperId, included)` — single-row idempotent
 *     patch. Returns the post-write state so the optimistic-update
 *     helper can reconcile.
 *   - `bulkSetChatPapers(jobId, sourceIds?, included)` — set many rows
 *     at once. Omit `sourceIds` to target every row for the job.
 *
 * All three funnel through `assertCallerOwnsJob` (convex/chat/auth.ts)
 * before touching data, so cross-user reads/writes surface as a
 * `FORBIDDEN` ConvexError envelope.
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { assertCallerOwnsJob } from "./auth";
import {
  classifySourceType,
  type SourceType,
} from "../../lib/chat/source-type";

export type ChatSourceRow = {
  chatPaperId: Id<"chatPapers">;
  sourceId: Id<"extractionJobSources">;
  jobId: Id<"extractionJobs">;
  position: number;
  included: boolean;
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  doi: string | null;
  pdfUrl: string | null;
  openalexId: string | null;
  bucketKey: string;
  sourceType: SourceType;
};

const sourceTypeValidator = v.union(
  v.literal("openalex"),
  v.literal("upload"),
  v.literal("zotero"),
  v.literal("history"),
  v.literal("unknown"),
);

const chatSourceRowValidator = v.object({
  chatPaperId: v.id("chatPapers"),
  sourceId: v.id("extractionJobSources"),
  jobId: v.id("extractionJobs"),
  position: v.number(),
  included: v.boolean(),
  title: v.string(),
  authors: v.array(v.string()),
  year: v.union(v.number(), v.null()),
  abstract: v.union(v.string(), v.null()),
  doi: v.union(v.string(), v.null()),
  pdfUrl: v.union(v.string(), v.null()),
  openalexId: v.union(v.string(), v.null()),
  bucketKey: v.string(),
  sourceType: sourceTypeValidator,
});

function toChatSourceRow(
  src: Doc<"extractionJobSources">,
  cp: Doc<"chatPapers">,
): ChatSourceRow {
  return {
    chatPaperId: cp._id,
    sourceId: src._id,
    jobId: src.jobId,
    position: src.position,
    included: cp.included,
    title: src.title,
    authors: src.authors,
    year: src.year ?? null,
    abstract: src.abstract ?? null,
    doi: src.doi ?? null,
    pdfUrl: src.pdfUrl ?? null,
    openalexId: src.openalexId ?? null,
    bucketKey: src.bucketKey,
    sourceType: classifySourceType(src),
  };
}

export const listChatSourcesWithInclusion = query({
  args: { jobId: v.id("extractionJobs") },
  returns: v.array(chatSourceRowValidator),
  handler: async (ctx, { jobId }): Promise<ChatSourceRow[]> => {
    await assertCallerOwnsJob(ctx, jobId);

    const [sources, chatPapers] = await Promise.all([
      ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
        .collect(),
      ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    ]);

    const inclusionBySourceId = new Map(
      chatPapers.map((cp) => [cp.sourceId, cp] as const),
    );

    const rows: ChatSourceRow[] = [];
    for (const src of sources) {
      const cp = inclusionBySourceId.get(src._id);
      // A chatPapers row is guaranteed 1:1 by plan-01's seed path, but
      // a millisecond race between ensureThreadForJob and the client's
      // first subscription could surface a source row before its
      // corresponding chatPapers row. Filter defensively; the next
      // reactive tick fills the gap.
      if (!cp) continue;
      rows.push(toChatSourceRow(src, cp));
    }
    rows.sort((a, b) => a.position - b.position);
    return rows;
  },
});

export const toggleChatPaper = mutation({
  args: {
    chatPaperId: v.id("chatPapers"),
    included: v.boolean(),
  },
  returns: v.object({
    chatPaperId: v.id("chatPapers"),
    included: v.boolean(),
  }),
  handler: async (ctx, { chatPaperId, included }) => {
    const row = await ctx.db.get(chatPaperId);
    if (!row) {
      throw createError("NOT_FOUND", "Chat paper not found");
    }
    await assertCallerOwnsJob(ctx, row.jobId);

    if (row.included !== included) {
      await ctx.db.patch(chatPaperId, { included });
    }
    return { chatPaperId, included };
  },
});

export const bulkSetChatPapers = mutation({
  args: {
    jobId: v.id("extractionJobs"),
    sourceIds: v.optional(v.array(v.id("extractionJobSources"))),
    included: v.boolean(),
  },
  returns: v.object({ changedCount: v.number() }),
  handler: async (ctx, { jobId, sourceIds, included }) => {
    await assertCallerOwnsJob(ctx, jobId);

    const allForJob = await ctx.db
      .query("chatPapers")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();

    const rows =
      sourceIds === undefined
        ? allForJob
        : (() => {
            const want = new Set(sourceIds);
            return allForJob.filter((r) => want.has(r.sourceId));
          })();

    let changedCount = 0;
    for (const row of rows) {
      if (row.included !== included) {
        await ctx.db.patch(row._id, { included });
        changedCount += 1;
      }
    }
    return { changedCount };
  },
});
