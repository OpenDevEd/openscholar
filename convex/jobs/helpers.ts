"use node";

/**
 * Universal Job System - Helper Internal Actions
 *
 * These internal actions are called by processors and encapsulate
 * the actual work for each job type.
 */
import { internalAction } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { v } from "convex/values";
import { extractText } from "unpdf";
import {
  rag,
  getAnalysisNamespace,
  getDocumentKey,
  chunkText,
  prepareDocumentContent,
} from "../rag/index";
import { getModel, withUserCreditsBatch } from "../ai/helpers";
import { processExtractionBatch, aggregateUsage } from "../../lib/ai/core";
import type { ExtractionItem, RagChunkWithPosition } from "../../lib/ai/core/batch-types";
import type { Id } from "../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// PDF DOWNLOAD HELPER
// ═══════════════════════════════════════════════════════════════════════════

// Config constants
const PDF_DOWNLOAD_CONFIG = {
  FETCH_TIMEOUT_MS: 30000,
  EXTRACTION_TIMEOUT_MS: 30000,
  MAX_RETRIES: 1,
  RETRY_DELAY_MS: 5000,
};

/**
 * Download and process a single PDF for a document.
 * Extracted from processNextOpenAccessPdf for reuse in the universal job system.
 */
export const downloadSinglePdf = internalAction({
  args: {
    documentId: v.id("documents"),
    analysisId: v.id("analyses"),
  },
  returns: v.object({
    success: v.boolean(),
    skipped: v.optional(v.boolean()),
    textLength: v.optional(v.number()),
    pages: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { documentId, analysisId }) => {
    // Get document
    const doc = await ctx.runQuery(internal.rag.queries.getDocument, {
      documentId,
    });

    if (!doc) {
      return { success: false, skipped: true, error: "Document not found" };
    }

    if (!doc.openAccessUrl) {
      return { success: false, skipped: true, error: "No open access URL" };
    }

    if (doc.fullText || doc.pdfStorageId) {
      return { success: false, skipped: true, error: "Already has PDF/text" };
    }

    // Import the smart fetch utilities from rag/actions
    // For now, we'll call the existing action through the scheduler pattern
    // This is a simplified version - the full logic is in processNextOpenAccessPdf
    try {
      const response = await fetchWithTimeout(doc.openAccessUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "application/pdf,*/*",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/pdf")) {
        return {
          success: false,
          skipped: true,
          error: `Not a PDF: ${contentType}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        return { success: false, error: "Empty PDF response" };
      }

      // Extract text with page boundaries
      const { fullText, pages } = await extractTextWithPages(arrayBuffer);

      if (!fullText || fullText.trim().length < 100) {
        return {
          success: false,
          error: `Insufficient text extracted (${fullText?.length || 0} chars)`,
        };
      }

      // Store PDF
      const pdfBuffer = new Uint8Array(arrayBuffer);
      const storageId = await ctx.storage.store(
        new Blob([pdfBuffer], { type: "application/pdf" })
      );

      // Save to document
      await ctx.runMutation(internal.rag.mutations.savePdfWithPages, {
        documentId,
        pdfStorageId: storageId,
        fullText,
        pdfPages: pages,
      });

      return {
        success: true,
        textLength: fullText.length,
        pages: pages.length,
        storageId,
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      return { success: false, error };
    }
  },
});

// Helper functions
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = PDF_DOWNLOAD_CONFIG.FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

interface PageBoundary {
  pageNumber: number;
  startChar: number;
  endChar: number;
}

async function extractTextWithPages(
  pdfData: ArrayBuffer,
  timeoutMs: number = PDF_DOWNLOAD_CONFIG.EXTRACTION_TIMEOUT_MS
): Promise<{ fullText: string; pages: PageBoundary[] }> {
  const bufferCopy = new Uint8Array(new ArrayBuffer(pdfData.byteLength));
  bufferCopy.set(new Uint8Array(pdfData));

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("PDF extraction timeout")), timeoutMs);
  });

  const extractPromise = (async () => {
    const result = await extractText(bufferCopy, { mergePages: false });

    const pages: PageBoundary[] = [];
    let currentChar = 0;

    const pageTexts = result.text as string[];
    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = pageTexts[i];
      pages.push({
        pageNumber: i + 1,
        startChar: currentChar,
        endChar: currentChar + pageText.length,
      });
      currentChar += pageText.length + 1;
    }

    const fullText = pageTexts.join("\n");
    return { fullText, pages };
  })();

  return Promise.race([extractPromise, timeoutPromise]);
}

// ═══════════════════════════════════════════════════════════════════════════
// RAG INDEXING HELPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Index a single document into the RAG system.
 */
export const indexSingleDocument = internalAction({
  args: {
    documentId: v.id("documents"),
    analysisId: v.id("analyses"),
  },
  returns: v.object({
    success: v.boolean(),
    chunksIndexed: v.optional(v.number()),
    entryId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, { documentId, analysisId }) => {
    // Get document
    const doc = await ctx.runQuery(internal.rag.queries.getDocument, {
      documentId,
    });

    if (!doc) {
      return { success: false, error: "Document not found" };
    }

    if (!doc.abstract && !doc.fullText) {
      return { success: false, error: "No content to index" };
    }

    try {
      const namespace = getAnalysisNamespace(analysisId);
      const contentKey = getDocumentKey(documentId, "content");

      // Prepare content
      const content = prepareDocumentContent({
        title: doc.title,
        abstract: doc.abstract,
        fullText: typeof doc.fullText === "string" ? doc.fullText : undefined,
        authors: doc.authors,
        year: doc.year,
      });

      // Chunk the content
      const chunks = chunkText(content);

      // Add to RAG
      const { entryId } = await rag.add(ctx, {
        namespace,
        key: contentKey,
        chunks,
        title: doc.title,
        metadata: {
          documentId,
          analysisId,
          title: doc.title,
          contentType: doc.fullText ? "fulltext" : "abstract",
        },
        filterValues: [
          { name: "analysisId", value: analysisId },
          { name: "documentId", value: documentId },
          { name: "contentType", value: doc.fullText ? "fulltext" : "abstract" },
        ],
      });

      // Update document with RAG entry ID
      await ctx.runMutation(internal.rag.mutations.setRagEntryId, {
        documentId,
        ragEntryId: entryId,
      });

      // Update status to ready
      await ctx.runMutation(internal.rag.mutations.updateDocumentStatus, {
        documentId,
        status: "ready",
      });

      return {
        success: true,
        chunksIndexed: chunks.length,
        entryId,
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      return { success: false, error };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION HELPER
// ═══════════════════════════════════════════════════════════════════════════

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
 * Extract data from a single document for a specific question.
 */
export const extractSingleDocument = internalAction({
  args: {
    documentId: v.id("documents"),
    analysisId: v.id("analyses"),
    userId: v.id("users"),
    questionId: v.string(),
    question: v.string(),
    questionType: v.string(),
    title: v.string(),
    abstract: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    extractionResultId: v.optional(v.id("extractionResults")),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    { documentId, analysisId, userId, questionId, question, questionType, title, abstract }
  ) => {
    try {
      // Create pending result
      const resultId: Id<"extractionResults"> = await ctx.runMutation(
        internal.extraction.results.createPending,
        {
          documentId,
          analysisId,
          questionId,
        }
      );

      // Fetch RAG context
      let ragContext: string | undefined;
      let ragChunks: RagChunkWithPosition[] | undefined;

      try {
        const result: RagSearchResult = await ctx.runAction(api.rag.actions.searchContext, {
          analysisId,
          query: question,
          limit: 3,
          documentId,
        });

        if (result.chunks && result.chunks.length > 0) {
          ragChunks = result.chunks.map((chunk) => ({
            text: chunk.text,
            sourceType: chunk.sourceType,
            pageNumber: chunk.pageNumber,
            startChar: chunk.startChar,
            endChar: chunk.endChar,
          }));
          ragContext = result.text;
        } else if (result.text && result.text.trim().length > 0) {
          ragContext = result.text;
        }
      } catch {
        // Continue without RAG context
      }

      // Process with LLM
      const extraction = await withUserCreditsBatch(
        ctx,
        userId,
        `Extraction (1 item)`,
        async () => {
          const model = await getModel();

          const { results, errors, usages } = await processExtractionBatch({
            model,
            items: [
              {
                documentId: documentId as string,
                resultId: resultId as string,
                title,
                abstract,
                questionId,
                question,
                type: questionType as "text" | "number" | "boolean",
                ragContext,
                ragChunks,
              },
            ],
          });

          return {
            result: { results, errors },
            totalUsage: aggregateUsage(usages),
          };
        }
      );

      // Save result
      const data = extraction.results[resultId];
      if (data) {
        await ctx.runMutation(internal.extraction.results.setResult, {
          resultId: resultId as Id<"extractionResults">,
          value: data.value,
          confidence: data.confidence,
          reasoning: data.reasoning,
          sources: data.sources,
          status: "completed",
        });

        return {
          success: true,
          extractionResultId: resultId,
        };
      } else if (extraction.errors.length > 0) {
        await ctx.runMutation(internal.extraction.results.setResult, {
          resultId: resultId as Id<"extractionResults">,
          value: null,
          status: "error",
        });

        return {
          success: false,
          error: extraction.errors[0]?.error || "Unknown error",
        };
      }

      return {
        success: false,
        error: "No result returned",
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      return { success: false, error };
    }
  },
});
