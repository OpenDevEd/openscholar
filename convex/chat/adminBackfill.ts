/**
 * One-shot admin backfill for plan-01: seed chatPapers rows for chat-mode
 * jobs that pre-date the bridge-table rollout.
 *
 * Idempotent on replay: skips jobs that already have any chatPapers row.
 * No-op once the new seed hook in persistPreparedSourcesForJob has been in
 * place long enough that every chat-mode job lands with its rows seeded at
 * ensureThreadForJob time.
 *
 * Run via:
 *   npx convex run chat/adminBackfill:backfillChatPapersForExistingChats
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { assertNonProd } from "../lib/assertNonProd";
import { buildSeedChatPaperRows } from "./chatPapersSeed";

export const backfillChatPapersForExistingChats = internalMutation({
  args: {},
  returns: v.object({
    jobsScanned: v.number(),
    jobsSeeded: v.number(),
    rowsInserted: v.number(),
  }),
  handler: async (ctx) => {
    assertNonProd();

    const chatJobs = await ctx.db
      .query("extractionJobs")
      .withIndex("by_mode", (q) => q.eq("mode", "chat"))
      .collect();

    let jobsSeeded = 0;
    let rowsInserted = 0;

    for (const job of chatJobs) {
      const existing = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .first();
      if (existing) continue;

      const sources = await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", job._id))
        .collect();
      if (sources.length === 0) continue;

      const seedRows = buildSeedChatPaperRows(
        job._id,
        sources.map((s) => s._id),
      );
      for (const row of seedRows) {
        await ctx.db.insert("chatPapers", row);
        rowsInserted += 1;
      }
      jobsSeeded += 1;
    }

    return {
      jobsScanned: chatJobs.length,
      jobsSeeded,
      rowsInserted,
    };
  },
});
