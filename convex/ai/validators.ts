import { v } from "convex/values";
import { MAX_BATCH_PAPERS, MAX_QUESTIONS, capped } from "../lib/listCaps";

/** The papers of a batch that failed, each with why: at most the batch. */
const batchErrorsValidator = capped(v.array(v.object({ paperId: v.string(), error: v.string() })), MAX_BATCH_PAPERS);

/** What a batch translation returns, keyed by paper ID. */
export const batchTranslationsValidator = v.object({
  results: capped(
    v.record(v.string(), v.object({ translatedTitle: v.string(), translatedAbstract: v.string(), noTranslationNeeded: v.boolean() })),
    MAX_BATCH_PAPERS,
  ),
  errors: batchErrorsValidator,
});

/** What a batch screening returns, keyed by paper ID, each paper's answers and confidences keyed by its encoded question. */
export const batchScreeningValidator = v.object({
  results: capped(
    v.record(
      v.string(),
      v.object({
        responses: capped(v.record(v.string(), v.union(v.boolean(), v.null())), MAX_QUESTIONS),
        // The confidence in each answer, under the same encoded keys.
        confidences: capped(v.record(v.string(), v.number()), MAX_QUESTIONS),
        confidence: v.number(),
      }),
    ),
    MAX_BATCH_PAPERS,
  ),
  errors: batchErrorsValidator,
});
