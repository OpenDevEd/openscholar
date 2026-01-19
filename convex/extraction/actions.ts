"use node";

/**
 * Extraction actions - AI-powered data extraction from documents
 */
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getModel, withAuthAndCreditsBatch } from "../ai/helpers";
import { processExtractionBatch, aggregateUsage } from "@/lib/ai/core";
import type { ExtractionItem } from "@/lib/ai/core/batch-types";
import type { Id } from "../_generated/dataModel";

/**
 * Run extraction for a single analysis.
 * Fetches all pending documents and questions, runs AI extraction, updates results.
 */
export const runExtraction = action({
  args: {
    analysisId: v.id("analyses"),
  },
  returns: v.object({
    processed: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx, { analysisId }) => {
    // Get analysis with questions
    const analysis = await ctx.runQuery(
      internal.extraction.internal.getAnalysisForExtraction,
      { analysisId }
    );

    if (!analysis) {
      throw new Error("Analysis not found");
    }

    if (analysis.extractionQuestions.length === 0) {
      return { processed: 0, errors: 0 };
    }

    // Get documents that need extraction
    const documents = await ctx.runQuery(
      internal.extraction.internal.getDocumentsForExtraction,
      { analysisId }
    );

    if (documents.length === 0) {
      return { processed: 0, errors: 0 };
    }

    // Get existing results to find what's already done
    const existingResults = await ctx.runQuery(
      internal.extraction.internal.getExistingResults,
      { analysisId }
    );

    const existingSet = new Set(
      existingResults.map((r) => `${r.documentId}:${r.questionId}`)
    );

    // Build extraction items for pending extractions
    const items: ExtractionItem[] = [];

    for (const doc of documents) {
      for (const q of analysis.extractionQuestions) {
        const key = `${doc._id}:${q.id}`;
        if (!existingSet.has(key)) {
          items.push({
            documentId: doc._id,
            resultId: "", // Will be created
            title: doc.title,
            abstract: doc.abstract || "",
            questionId: q.id,
            question: q.question,
            type: q.type as "text" | "number" | "boolean",
          });
        }
      }
    }

    if (items.length === 0) {
      return { processed: 0, errors: 0 };
    }

    // Create pending result records and get their IDs
    const resultIds = await ctx.runMutation(
      internal.extraction.results.createBatchPending,
      {
        items: items.map((item) => ({
          documentId: item.documentId as Id<"documents">,
          analysisId,
          questionId: item.questionId,
        })),
      }
    );

    // Update items with result IDs
    const itemsWithIds: ExtractionItem[] = items.map((item, i) => ({
      ...item,
      resultId: resultIds[i],
    }));

    // Update analysis status
    await ctx.runMutation(internal.extraction.analysesMutations.setStatus, {
      id: analysisId,
      status: "processing",
    });

    return withAuthAndCreditsBatch(
      ctx,
      `Extraction (${items.length} items)`,
      async () => {
        const model = await getModel();

        const { results, errors, usages } = await processExtractionBatch({
          model,
          items: itemsWithIds,
        });

        // Update successful results
        for (const [resultId, data] of Object.entries(results)) {
          await ctx.runMutation(internal.extraction.results.setResult, {
            resultId: resultId as Id<"extractionResults">,
            value: data.value,
            confidence: data.confidence,
            reasoning: data.reasoning,
            status: "completed",
          });
        }

        // Update failed results
        for (const error of errors) {
          await ctx.runMutation(internal.extraction.results.setResult, {
            resultId: error.paperId as Id<"extractionResults">,
            value: null,
            status: "error",
          });
        }

        // Update analysis status
        await ctx.runMutation(internal.extraction.analysesMutations.setStatus, {
          id: analysisId,
          status: errors.length === 0 ? "completed" : "completed",
        });

        return {
          result: {
            processed: Object.keys(results).length,
            errors: errors.length,
          },
          totalUsage: aggregateUsage(usages),
        };
      }
    );
  },
});

/**
 * Run extraction for a single document (re-run or new questions)
 */
export const extractDocument = action({
  args: {
    documentId: v.id("documents"),
    questionIds: v.optional(v.array(v.string())),
  },
  returns: v.object({
    processed: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx, { documentId, questionIds }) => {
    const doc = await ctx.runQuery(
      internal.extraction.internal.getDocumentForExtraction,
      { documentId }
    );

    if (!doc) {
      throw new Error("Document not found");
    }

    const analysis = await ctx.runQuery(
      internal.extraction.internal.getAnalysisForExtraction,
      { analysisId: doc.analysisId }
    );

    if (!analysis) {
      throw new Error("Analysis not found");
    }

    const questionsToExtract = questionIds
      ? analysis.extractionQuestions.filter((q) => questionIds.includes(q.id))
      : analysis.extractionQuestions;

    if (questionsToExtract.length === 0) {
      return { processed: 0, errors: 0 };
    }

    // Create pending results
    const resultIds = await ctx.runMutation(
      internal.extraction.results.createBatchPending,
      {
        items: questionsToExtract.map((q) => ({
          documentId,
          analysisId: doc.analysisId,
          questionId: q.id,
        })),
      }
    );

    const items: ExtractionItem[] = questionsToExtract.map((q, i) => ({
      documentId,
      resultId: resultIds[i],
      title: doc.title,
      abstract: doc.abstract || "",
      questionId: q.id,
      question: q.question,
      type: q.type as "text" | "number" | "boolean",
    }));

    return withAuthAndCreditsBatch(
      ctx,
      `Extract document (${items.length} questions)`,
      async () => {
        const model = await getModel();

        const { results, errors, usages } = await processExtractionBatch({
          model,
          items,
        });

        for (const [resultId, data] of Object.entries(results)) {
          await ctx.runMutation(internal.extraction.results.setResult, {
            resultId: resultId as Id<"extractionResults">,
            value: data.value,
            confidence: data.confidence,
            reasoning: data.reasoning,
            status: "completed",
          });
        }

        for (const error of errors) {
          await ctx.runMutation(internal.extraction.results.setResult, {
            resultId: error.paperId as Id<"extractionResults">,
            value: null,
            status: "error",
          });
        }

        return {
          result: {
            processed: Object.keys(results).length,
            errors: errors.length,
          },
          totalUsage: aggregateUsage(usages),
        };
      }
    );
  },
});
