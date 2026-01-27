"use node";

/**
 * Extraction actions - AI-powered data extraction from documents
 * Enhanced with RAG (Retrieval-Augmented Generation) for full-text search.
 */
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { getModel, withAuthAndCreditsBatch } from "../ai/helpers";
import { processExtractionBatch, aggregateUsage } from "../../lib/ai/core";
import type { ExtractionItem, RagChunkWithPosition } from "../../lib/ai/core/batch-types";
import type { Id } from "../_generated/dataModel";

// Type for extraction questions from analysis
type ExtractionQuestion = {
  id: string;
  key: string;
  question: string;
  type: string;
};

// Result type from searchContext
interface RagSearchResult {
  text: string;
  chunks: Array<{
    text: string;
    score: number;
    documentId: string;
    title: string;
    sourceType: "abstract" | "pdf";
    pageNumber?: number;
    startChar: number;
    endChar: number;
  }>;
}

/**
 * Fetch RAG context for a document and question.
 * Returns relevant full-text excerpts with position info for citation tracking.
 */
async function fetchRagContext(
  ctx: any,
  analysisId: Id<"analyses">,
  documentId: Id<"documents">,
  question: string
): Promise<{ ragContext?: string; ragChunks?: RagChunkWithPosition[] }> {
  try {
    const result: RagSearchResult = await ctx.runAction(api.rag.actions.searchContext, {
      analysisId,
      query: question,
      limit: 3,
      documentId,
    });
    
    // Return chunks with position info if available
    if (result.chunks && result.chunks.length > 0) {
      const ragChunks: RagChunkWithPosition[] = result.chunks.map((chunk) => ({
        text: chunk.text,
        sourceType: chunk.sourceType,
        pageNumber: chunk.pageNumber,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
      }));
      
      return {
        ragContext: result.text,
        ragChunks,
      };
    }
    
    // Legacy fallback: just text
    if (result.text && result.text.trim().length > 0) {
      return { ragContext: result.text };
    }
    
    return {};
  } catch (error) {
    // RAG search failed - continue without context
    console.warn("RAG search failed for document:", documentId, error);
    return {};
  }
}

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
      const { ragContext, ragChunks } = await fetchRagContext(
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
        ragChunks,
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

        // Update successful results (with sources for citation tracking)
        for (const [resultId, data] of Object.entries(results)) {
          await ctx.runMutation(internal.extraction.results.setResult, {
            resultId: resultId as Id<"extractionResults">,
            value: data.value,
            confidence: data.confidence,
            reasoning: data.reasoning,
            sources: data.sources,
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


