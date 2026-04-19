"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { renderPaperCorpus } from "../../lib/chat/render-corpus";

/**
 * Builds the chat system prompt array for a given job. Returns two
 * messages:
 *   1. persona + citation instructions
 *   2. the paper corpus (XML envelope, sorted by openalexId ASC)
 *
 * The split is intentional: the corpus message is the cache-hot prefix
 * once OpenRouter's v6 provider starts forwarding cache_control through
 * the Responses API (see plan §4i). For V1 neither branch carries
 * providerOptions.cacheControl — the provider drops them silently.
 */
export const buildSystemPromptForJob = internalAction({
  args: { jobId: v.id("extractionJobs") },
  returns: v.array(
    v.object({
      role: v.literal("system"),
      content: v.string(),
    }),
  ),
  handler: async (ctx, { jobId }): Promise<Array<{ role: "system"; content: string }>> => {
    // Typed via the explicit shape we read — sidesteps a circularity
    // between ctx.runQuery's inferred type and this action's `returns`.
    type SourceRow = {
      openalexId?: string;
      title: string;
      authors: string[];
      year?: number;
      abstract?: string;
    };
    const sources = (await ctx.runQuery(
      internal.extraction.queries.internal.getJobSourcesInternal,
      { jobId },
    )) as SourceRow[];

    const corpus = renderPaperCorpus(
      sources.map((s) => ({
        openalexId: s.openalexId,
        title: s.title,
        authors: s.authors,
        year: s.year,
        abstract: s.abstract,
      })),
    );

    return [
      {
        role: "system" as const,
        content:
          "You are a research assistant answering questions about the user's selected papers.\n" +
          "Cite papers by their id in square brackets (e.g. [P3]) whenever you use their content.\n" +
          "If an answer is not supported by the papers, say so explicitly.",
      },
      {
        role: "system" as const,
        content: `<papers count="${sources.length}">\n${corpus}\n</papers>`,
      },
    ];
  },
});

// Export the job-id type for consumers that call this indirectly.
export type ChatSystemPromptJobId = Id<"extractionJobs">;
