import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  filterAndPreservePositions,
  renderPaperCorpus,
} from "../../lib/chat/render-corpus";
import {
  readChatSourceRows,
  toCorpusSource,
} from "./sourceReadModel";

/**
 * Builds the chat system prompt array for a given job. Returns two or
 * three messages:
 *   1. persona + citation instructions
 *   2. the paper corpus (XML envelope, papers sorted by stable `position`
 *      ASC with gaps preserved when rows are excluded — see plan-02)
 *   3. (only when `webSearchEnabled === true`) the supplementary
 *      web-search policy — corpus is PRIMARY, web is a fill-the-gaps
 *      tool, [Pn] is paper-only.
 *
 * The split is intentional: the corpus message is the cache-hot prefix
 * once OpenRouter's v6 provider starts forwarding cache_control through
 * the Responses API. For V1 neither branch carries
 * providerOptions.cacheControl — the provider drops them silently.
 */

/**
 * Locked policy text appended as a third system message when the user
 * has opted into web search for the thread. Tuned for "supplement, not
 * primary" — the corpus stays the source of truth, web search fills
 * gaps and adds adjacent on-topic context. Citations stay [Pn] for
 * papers; web hits get inline markdown links.
 */
export const WEB_SEARCH_SYSTEM_INSTRUCTION = [
  "WEB SEARCH POLICY:",
  "- The paper corpus above is your PRIMARY source. Always answer from the papers when possible and cite as [Pn].",
  "- A web_search tool is available only as a SUPPLEMENT. Use it when:",
  "  • The included papers do not cover an aspect of the user's question, OR",
  "  • You need to add adjacent on-topic context (e.g. a definition, a related dataset, a recent development).",
  "- Do NOT use web search for questions the corpus already answers.",
  "- When you cite a web result, do so by URL inline (markdown link). Never reuse [Pn] for web sources.",
  "- One short, focused web query per call. Avoid redundant searches.",
].join("\n");

export const buildSystemPromptForJob = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  returns: v.array(
    v.object({
      role: v.literal("system"),
      content: v.string(),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const rows = await readChatSourceRows(ctx, jobId);
    const prompted = filterAndPreservePositions(
      rows.map(toCorpusSource),
      new Set(
        rows
          .filter((row) => row.included)
          .map((row) => String(row.sourceId)),
      ),
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
