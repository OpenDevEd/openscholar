import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  filterAndPreservePositions,
  renderPaperCorpus,
  type CorpusSource,
} from "../../lib/chat/render-corpus";
import { PAPER_LIMIT_MAX } from "../extraction/bucket/limits";

/**
 * Builds the chat system prompt array for a given job. Returns two
 * messages:
 *   1. persona + citation instructions
 *   2. the paper corpus (XML envelope, papers sorted by stable `position`
 *      ASC with gaps preserved when rows are excluded — see plan-02)
 *
 * The split is intentional: the corpus message is the cache-hot prefix
 * once OpenRouter's v6 provider starts forwarding cache_control through
 * the Responses API. For V1 neither branch carries
 * providerOptions.cacheControl — the provider drops them silently.
 */

function toCorpusSource(row: Doc<"extractionJobSources">): CorpusSource {
  return {
    sourceId: row._id,
    position: row.position,
    openalexId: row.openalexId,
    title: row.title,
    authors: row.authors,
    year: row.year,
    abstract: row.abstract,
    doi: row.doi,
    pdfUrl: row.pdfUrl,
  };
}

export const buildSystemPromptForJob = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.array(
    v.object({
      role: v.literal("system"),
      content: v.string(),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const sourceRows = await ctx.db
      .query("extractionJobSources")
      .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
      .take(PAPER_LIMIT_MAX * 2);
    const corpusSources = sourceRows.map(toCorpusSource);

    // Live-read the inclusion layer. Re-evaluated at every stream-start
    // so mid-conversation toggles take effect on the very next turn
    // (decision D2). Rows missing from chatPapers (e.g. a chat seeded
    // before the backfill ran) are implicitly excluded — the send-guard
    // in messages.ts blocks sends when zero rows pass this filter.
    const includedRows = await ctx.db
      .query("chatPapers")
      .withIndex("by_job_included", (q) =>
        q.eq("jobId", jobId).eq("included", true),
      )
      .take(PAPER_LIMIT_MAX * 2);
    const includedSourceIds = new Set<string>(
      includedRows.map((r) => r.sourceId),
    );
    const prompted = filterAndPreservePositions(
      corpusSources,
      includedSourceIds,
    );

    return [
      {
        role: "system" as const,
        content:
          "You are a research assistant answering questions about the user's selected papers.\n" +
          "\n" +
          "CITATION RULES — follow these exactly:\n" +
          "- Cite papers inline using their id in square brackets: [P3].\n" +
          '- Use exactly this format: opening "[", capital "P", integer, closing "]".\n' +
          "- For a single paper: [P3]. For several papers supporting the same claim, combine them inside one pair of brackets: [P1, P3, P7].\n" +
          "- Place the citation immediately after the claim it supports.\n" +
          "- Cite every paper whose content you use.\n" +
          "- Do not invent paper ids. Only cite ids that appear in the <papers> list below.\n" +
          "- Paper ids are stable anchors assigned once per chat. The visible list may contain gaps (e.g. only [P1], [P4], [P7] appear) when the user has excluded sources from context — always cite the exact id shown in each <paper id=\"...\"> attribute and never cite ids that are absent from the visible list.\n" +
          "- If an answer is not supported by the provided papers, say so explicitly and do not cite.\n" +
          "\n" +
          'Examples of valid citations: "This claim is well established [P2]." · "Multiple authors report similar findings [P1, P4, P9]."',
      },
      {
        role: "system" as const,
        content: renderPaperCorpus(prompted),
      },
    ];
  },
});

// Export the job-id type for consumers that call this indirectly.
export type ChatSystemPromptJobId = Id<"extractionJobs">;
