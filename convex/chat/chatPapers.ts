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
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { assertCallerOwnsJob } from "./auth";
import {
  chatSourcesSnapshotValidator,
  readChatSourcesSnapshot,
} from "./sourceReadModel";

export type { ChatSourceRow } from "./sourceReadModel";

export const listChatSourcesWithInclusion = query({
  args: { jobId: v.id("extractionJobs") },
  returns: chatSourcesSnapshotValidator,
  handler: async (ctx, { jobId }) => {
    await assertCallerOwnsJob(ctx, jobId);
    return await readChatSourcesSnapshot(ctx, jobId);
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
