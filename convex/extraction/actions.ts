"use node";

/**
 * Extraction actions - AI-powered data extraction from documents
 * Enhanced with RAG (Retrieval-Augmented Generation) for full-text search.
 */
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { getModel, withAuthAndCreditsBatch } from "../ai/helpers";
import { processExtractionBatch, aggregateUsage } from "@/lib/ai/core";
import type { ExtractionItem } from "@/lib/ai/core/batch-types";
import type { Id } from "../_generated/dataModel";

// Type for extraction questions from analysis
type ExtractionQuestion = {
  id: string;
  key: string;
  question: string;
  type: string;
};

/**
 * Fetch RAG context for a document and question.
 * Returns relevant full-text excerpts if the document has been indexed.
 */
async function fetchRagContext(
  ctx: any,
  analysisId: Id<"analyses">,
  documentId: Id<"documents">,
  question: string
): Promise<string | undefined> {
  try {
    const result = await ctx.runAction(api.rag.actions.searchContext, {
      analysisId,
      query: question,
      limit: 3,
      documentId,
    });
    
    // Return the combined text if we got results
    if (result.text && result.text.trim().length > 0) {
      return result.text;
    }
    return undefined;
  } catch (error) {
    // RAG search failed - continue without context
    console.warn("RAG search failed for document:", documentId, error);
    return undefined;
  }
}

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
      existingResults.map((r: { documentId: string; questionId: string }) => `${r.documentId}:${r.questionId}`)
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

    // Update items with result IDs and fetch RAG context
    const itemsWithIds: ExtractionItem[] = [];
    
    // Group items by document to avoid redundant RAG searches
    const documentQuestions = new Map<string, { doc: typeof documents[0]; questions: ExtractionQuestion[] }>();
    for (const doc of documents) {
      documentQuestions.set(doc._id, { doc, questions: [] });
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const q = analysis.extractionQuestions.find((eq: ExtractionQuestion) => eq.id === item.questionId);
      if (q) {
        documentQuestions.get(item.documentId)?.questions.push(q);
      }
    }

    // Fetch RAG context for each document-question pair
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let ragContext: string | undefined;
      
      // Try to fetch RAG context for this question
      ragContext = await fetchRagContext(
        ctx,
        analysisId,
        item.documentId as Id<"documents">,
        item.question
      );
      
      itemsWithIds.push({
        ...item,
        resultId: resultIds[i],
        ragContext,
      });
    }

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
      ? analysis.extractionQuestions.filter((q: ExtractionQuestion) => questionIds.includes(q.id))
      : analysis.extractionQuestions;

    if (questionsToExtract.length === 0) {
      return { processed: 0, errors: 0 };
    }

    // Create pending results
    const resultIds = await ctx.runMutation(
      internal.extraction.results.createBatchPending,
      {
              items: questionsToExtract.map((q: ExtractionQuestion) => ({
          documentId,
          analysisId: doc.analysisId,
          questionId: q.id,
        })),
      }
    );

    // Build items with RAG context
    const items: ExtractionItem[] = [];
    for (let i = 0; i < questionsToExtract.length; i++) {
      const q = questionsToExtract[i] as ExtractionQuestion;
      
      // Fetch RAG context for this question
      const ragContext = await fetchRagContext(
        ctx,
        doc.analysisId,
        documentId,
        q.question
      );
      
      items.push({
        documentId,
        resultId: resultIds[i],
        title: doc.title,
        abstract: doc.abstract || "",
        questionId: q.id,
        question: q.question,
        type: q.type as "text" | "number" | "boolean",
        ragContext,
      });
    }

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
