import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { readJobSources } from "../extraction/jobSources";
import { renderPaperCorpus } from "../../lib/chat/render-corpus";
import { PAPER_LIMIT_MAX } from "../extraction/bucket/limits";

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
export const buildSystemPromptForJob = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.array(
    v.object({
      role: v.literal("system"),
      content: v.string(),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const sources = await readJobSources(ctx, jobId, PAPER_LIMIT_MAX * 2);
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
          "\n" +
          "CITATION RULES — follow these exactly:\n" +
          "- Cite papers inline using their id in square brackets: [P3].\n" +
          '- Use exactly this format: opening "[", capital "P", integer, closing "]".\n' +
          "- For a single paper: [P3]. For several papers supporting the same claim, combine them inside one pair of brackets: [P1, P3, P7].\n" +
          "- Place the citation immediately after the claim it supports.\n" +
          "- Cite every paper whose content you use.\n" +
          "- Do not invent paper ids. Only cite ids that appear in the <papers> list below.\n" +
          "- If an answer is not supported by the provided papers, say so explicitly and do not cite.\n" +
          "\n" +
          'Examples of valid citations: "This claim is well established [P2]." · "Multiple authors report similar findings [P1, P4, P9]."',
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
