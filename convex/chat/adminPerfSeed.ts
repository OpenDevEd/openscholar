/**
 * Plan 06 § Performance measurement — dev-only seed helper.
 *
 * Creates a chat-mode `extractionJobs` row with N synthetic
 * `extractionJobSources` and seeds `chatPapers` 1:1 with `included=true`
 * so the Sources panel + composer + agent can be exercised at scale
 * (default 500 rows — the documented ceiling) without uploading real
 * papers.
 *
 * Run via:
 *   npx convex run chat/adminPerfSeed:seedPerfChat \
 *     '{"userId":"<id>","count":500}'
 *
 * Returns `{ jobId, threadId }` so the operator can navigate straight
 * to `/extraction/<jobId>` and start measuring.
 *
 * Hard-gated to non-prod via `assertNonProd` — same pattern as the
 * plan-01 backfill. Never ship a 500-row seed to prod.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
} from "../lib/functions";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { assertNonProd } from "../lib/assertNonProd";
import { paperChat } from "./agent";
import { buildSeedChatPaperRows } from "./chatPapersSeed";

const DEFAULT_COUNT = 500;
const MAX_COUNT = 2_000;

/**
 * Builds N synthetic source rows. Authors / abstracts are intentionally
 * realistic-shaped so the weighted search scorer + match-snippet
 * extractor exercise the same code paths they would on real data.
 */
function buildSyntheticSourceRow(
  jobId: Id<"extractionJobs">,
  position: number,
): Omit<
  {
    jobId: Id<"extractionJobs">;
    position: number;
    bucketKey: string;
    source: "library";
    sourceRefId: string;
    title: string;
    authors: string[];
    year: number;
    doi: string;
    openalexId: string;
    abstract: string;
  },
  never
> {
  const seq = String(position).padStart(4, "0");
  return {
    jobId,
    position,
    bucketKey: `perf:synthetic:${seq}`,
    source: "library",
    sourceRefId: `perf-${seq}`,
    title: `Synthetic perf paper ${position} on photosynthesis dynamics in marine systems`,
    authors: [`Author ${seq}, P.`, `Co-author ${seq}, Q.`, `Reviewer ${seq}, R.`],
    year: 2000 + (position % 26),
    doi: `10.99999/perf.${seq}`,
    openalexId: `WPERF${seq}`,
    abstract: `Synthetic abstract ${position}. We examine the dynamics of system behaviour at scale, looking at how the inclusion toggle and source filter behave under heavy row counts. Citation density and metadata fan-out match production envelopes.`,
  };
}

export const seedPerfChatRows = internalMutation({
  args: {
    userId: v.id("users"),
    count: v.number(),
    name: v.optional(v.string()),
  },
  returns: v.object({
    jobId: v.id("extractionJobs"),
    inserted: v.number(),
  }),
  handler: async (ctx, { userId, count, name }) => {
    assertNonProd();

    if (count < 1 || count > MAX_COUNT) {
      throw new Error(
        `seedPerfChatRows: count must be between 1 and ${MAX_COUNT}, got ${count}`,
      );
    }

    const now = Date.now();
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat",
      sourceType: "mixed",
      name: name ?? `Perf seed (${count} sources)`,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      lastMessageAt: now,
    });

    const sourceIds: Id<"extractionJobSources">[] = [];
    for (let position = 1; position <= count; position++) {
      const sourceId = await ctx.db.insert(
        "extractionJobSources",
        buildSyntheticSourceRow(jobId, position),
      );
      sourceIds.push(sourceId);
    }

    const seedRows = buildSeedChatPaperRows(jobId, sourceIds);
    for (const row of seedRows) {
      await ctx.db.insert("chatPapers", row);
    }

    return { jobId, inserted: count };
  },
});

export const seedPerfChat = internalAction({
  args: {
    userId: v.id("users"),
    count: v.optional(v.number()),
    name: v.optional(v.string()),
  },
  returns: v.object({
    jobId: v.id("extractionJobs"),
    threadId: v.string(),
    inserted: v.number(),
  }),
  handler: async (
    ctx: ActionCtx,
    { userId, count, name },
  ): Promise<{
    jobId: Id<"extractionJobs">;
    threadId: string;
    inserted: number;
  }> => {
    assertNonProd();

    const targetCount = count ?? DEFAULT_COUNT;
    const seeded: { jobId: Id<"extractionJobs">; inserted: number } =
      await ctx.runMutation(internal.chat.adminPerfSeed.seedPerfChatRows, {
        userId,
        count: targetCount,
        name,
      });

    const { threadId } = await paperChat.createThread(ctx, {
      userId,
      title: name ?? `Perf seed (${targetCount} sources)`,
    });

    await ctx.runMutation(internal.chat.threads.completeThreadForJob, {
      jobId: seeded.jobId,
      threadId,
    });

    return { jobId: seeded.jobId, threadId, inserted: seeded.inserted };
  },
});
