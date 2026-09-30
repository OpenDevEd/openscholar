/**
 * Shared helpers used across every queries/* submodule.
 *
 * These helpers only load persisted extraction rows. Manual review overlay
 * data has been removed, so result readers return raw extractionResults docs.
 */

import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { MIN_ABSTRACT_LENGTH } from "../content";
import { PAPER_LIMIT } from "@/lib/extraction/limits";
import { MAX_QUESTIONS_PER_JOB } from "../validators";

export function hasUsableAbstract(abstract?: string) {
  return (
    typeof abstract === "string" && abstract.trim().length > MIN_ABSTRACT_LENGTH
  );
}

export function hasUsablePdfSource(paper: Doc<"extractionPapers">) {
  return Boolean(
    paper.pdfUrl || paper.storageId || paper.ragEntryId || paper.isIndexed,
  );
}

export function buildQuestionInfoByKey(
  questions: Doc<"extractionQuestions">[],
) {
  return new Map(
    questions.map((question) => [
      question.key,
      {
        key: question.key,
        question: question.question,
        type: question.type,
        description: question.description,
      },
    ]),
  );
}

/**
 * Load result rows only for the visible page papers.
 */
export async function loadResultsByPaperIds(
  ctx: QueryCtx,
  paperIds: ReadonlyArray<Id<"extractionPapers">>,
): Promise<Map<string, Doc<"extractionResults">[]>> {
  const resultGroups = await Promise.all(
    paperIds.map(async (paperId) => [
      paperId,
      await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .collect(),
    ] as const),
  );

  return new Map<string, Doc<"extractionResults">[]>(
    resultGroups.map(([paperId, results]) => [paperId, results]),
  );
}
