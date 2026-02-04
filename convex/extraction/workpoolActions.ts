"use node";

/**
 * Extraction Actions using Workpool pattern with Hybrid RAG
 * Implements multi-query search + LLM reranking for better PDF content extraction
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { getModel } from "../ai/helpers";
import { downloadPdf, type DownloadPdfResult } from "../../lib/pdf/download";
import {
  extractAndChunkPdf,
  type ChunkMetadata,
  type ChunkWithMetadata,
  formatChunkWithMetadata,
  prepareChunksForRag,
} from "./chunking";
import { MIN_ABSTRACT_LENGTH } from "./content";
import {
  buildEnhancedExtractionPrompt,
  buildRerankingPrompt,
  buildQueryExpansionPrompt,
  detectQuestionType,
  type ExtractionQuestion,
} from "./prompts";

// Initialize RAG
const rag = new RAG<{ paperId: string }>(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
  filterNames: ["paperId"],
});

// Result type for paper processing
interface ProcessResult {
  success: boolean;
  paperId: string;
  results?: Array<{
    questionKey: string;
    answer: any;
    confidence?: number;
    reasoning?: string;
    contextChunks?: string[];
    pdfContentUsed?: boolean;
  }>;
  error?: string;
  creditsUsed?: number;
  pdfUsed?: boolean;
  storageId?: string;
}

// Track chunk content by creating a hash for deduplication
function getChunkHash(text: string): string {
  // Simple hash for deduplication
  let hash = 0;
  const str = text.substring(0, 100); // Hash first 100 chars
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString();
}

function normalizeChunkMetadata(
  metadata: unknown,
  text: string,
  index: number
): ChunkMetadata {
  const safeTextLength = Math.max(text.length, 0);
  const fallback: ChunkMetadata = {
    page: 1,
    charRange: [0, safeTextLength],
    totalPages: 1,
    chunkIndex: index,
  };

  if (!metadata || typeof metadata !== "object") {
    return fallback;
  }

  const typed = metadata as Partial<ChunkMetadata>;
  const page =
    typeof typed.page === "number" && Number.isFinite(typed.page)
      ? typed.page
      : fallback.page;
  const totalPages =
    typeof typed.totalPages === "number" && Number.isFinite(typed.totalPages)
      ? typed.totalPages
      : fallback.totalPages;
  const chunkIndex =
    typeof typed.chunkIndex === "number" && Number.isFinite(typed.chunkIndex)
      ? typed.chunkIndex
      : fallback.chunkIndex;

  let charRange = fallback.charRange;
  if (Array.isArray(typed.charRange) && typed.charRange.length >= 2) {
    const start = Number(typed.charRange[0]);
    const end = Number(typed.charRange[1]);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      charRange = [start, end];
    }
  }

  return {
    page,
    charRange,
    totalPages,
    chunkIndex,
  };
}

/**
 * Generate query variations for hybrid search
 */
async function generateQueryVariations(
  question: string,
  type: "factual" | "interpretive"
): Promise<string[]> {
  const variations: string[] = [question]; // Original question

  // Add keyword-focused variation for factual questions
  if (type === "factual") {
    // Extract key terms - look for numbers, measurements, and specific terms
    const keywords = question
      .replace(/\b(what|when|where|who|which|how many|how much|is|are|was|were|did|do|does)\b/gi, "")
      .replace(/\?/g, "")
      .trim();
    if (keywords && keywords !== question) {
      variations.push(keywords);
    }
  }

  // Add expanded variation with academic language
  try {
    const { text } = await generateText({
      model: await getModel(),
      prompt: buildQueryExpansionPrompt(question),
      temperature: 0.1,
    });

    // Parse the response to extract queries
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.includes("QUERY_2:") || line.includes("QUERY_3:")) {
        const query = line.split(":")[1]?.trim();
        if (query && !variations.includes(query)) {
          variations.push(query);
        }
      }
    }
  } catch (error) {
    console.warn(`[generateQueryVariations] Failed to generate expanded query: ${error}`);
  }

  return variations.slice(0, 3); // Max 3 variations
}

/**
 * Rerank chunks using LLM scoring
 */
async function rerankChunksWithLLM(
  question: string,
  chunks: Array<{ text: string; metadata: any }>
): Promise<Array<{ text: string; metadata: any; relevanceScore: number }>> {
  const scoredChunks = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const { text } = await generateText({
          model: await getModel(),
          prompt: buildRerankingPrompt(question, chunk.text, chunk.metadata),
          temperature: 0,
        });

        // Parse score from response
        const scoreMatch = text.match(/(\d+\.?\d*)/);
        const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;

        // Normalize to 0-1 range
        const normalizedScore = Math.min(Math.max(score, 0), 1);

        return {
          ...chunk,
          relevanceScore: normalizedScore,
        };
      } catch (error) {
        console.warn(`[rerankChunksWithLLM] Failed to score chunk: ${error}`);
        return {
          ...chunk,
          relevanceScore: 0.5, // Default middle score
        };
      }
    })
  );

  // Sort by relevance score descending
  return scoredChunks.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Perform hybrid search with multiple query variations
 */
async function performHybridSearch(
  ctx: any,
  namespace: string,
  question: string,
  paperId: string,
  maxRetries: number = 3
): Promise<Array<{ text: string; metadata: any }>> {
  const questionType = detectQuestionType(question);
  console.log(`[performHybridSearch] Question type: ${questionType}`);

  // Generate query variations
  const queryVariations = await generateQueryVariations(question, questionType);
  console.log(`[performHybridSearch] Using ${queryVariations.length} query variations`);

  // Collect results from all queries
  const allResults: Array<{ text: string; metadata: any; hash: string }> = [];
  const seenHashes = new Set<string>();

  const getChunksFromResult = (result: any) => {
    if (result?.content && Array.isArray(result.content)) {
      return result.content
        .map((chunk: any, index: number) => {
          const text = typeof chunk?.text === "string" ? chunk.text : "";
          if (!text) return null;
          return {
            text,
            metadata: normalizeChunkMetadata(chunk?.metadata, text, index),
          };
        })
        .filter((chunk: { text: string; metadata: ChunkMetadata } | null) =>
          Boolean(chunk)
        );
    }
    const text = typeof result?.text === "string" ? result.text : "";
    if (!text) {
      return [];
    }
    return [
      {
        text,
        metadata: normalizeChunkMetadata(result?.metadata, text, 0),
      },
    ];
  };

  // Run searches with retry logic
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let foundNewResults = false;

    for (const query of queryVariations) {
      try {
        const searchResults = await rag.search(ctx, {
          namespace,
          query,
          limit: 10,
          filters: [{ name: "paperId", value: paperId }],
        });

        const results = Array.isArray(searchResults?.results)
          ? searchResults.results
          : [];

        if (results.length > 0) {
          for (const result of results) {
            for (const chunk of getChunksFromResult(result)) {
              const text = chunk.text || "";
              const metadata = chunk.metadata || {};
              const hash = getChunkHash(text);

              if (!seenHashes.has(hash)) {
                seenHashes.add(hash);
                allResults.push({ text, metadata, hash });
                foundNewResults = true;
              }
            }
          }
        }
      } catch (error) {
        console.error(`[performHybridSearch] Query failed: ${query}`, error);
      }
    }

    if (foundNewResults || attempt === maxRetries) {
      break;
    }

    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(`[performHybridSearch] Found ${allResults.length} unique chunks`);
  return allResults.map(({ text, metadata }) => ({ text, metadata }));
}

// Process single paper - NO internal calls allowed
export const processPaperAction = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    pdfUrl: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    title: v.string(),
    abstract: v.optional(v.string()),
    doi: v.optional(v.string()),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("boolean"),
          v.literal("number"),
          v.literal("array")
        ),
        description: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<ProcessResult> => {
    const startTime = Date.now();
    
    console.log(`\n========================================`);
    console.log(`[processPaperAction] ACTION STARTED`);
    console.log(`[processPaperAction] Paper ID: ${args.paperId}`);
    console.log(`[processPaperAction] Title: ${args.title}`);
    console.log(`[processPaperAction] PDF URL: ${args.pdfUrl || "NONE"}`);
    console.log(`[processPaperAction] Abstract: ${args.abstract ? "YES" : "NO"}`);
    console.log(`[processPaperAction] Questions count: ${args.questions.length}`);
    console.log(`========================================\n`);

    try {
      console.log(`[processPaperAction] BEGIN PROCESSING - Paper ${args.paperId}`);
      
      let chunksWithMetadata: ChunkWithMetadata[] = [];
      let storageId: string | undefined;
      let ragIndexed = false;
      const effectiveStorageId = args.storageId;

      let pdfBlob: Blob | null = null;

      if (effectiveStorageId) {
        console.log(`[processPaperAction] STEP 1 - Loading PDF from storage: ${effectiveStorageId}`);
        const stored = await ctx.storage.get(effectiveStorageId);
        if (stored) {
          pdfBlob = stored;
          storageId = effectiveStorageId;
        }
      }

      // Step 1: Try to download and process PDF if URL is available
      if (!pdfBlob && args.pdfUrl) {
        console.log(`[processPaperAction] STEP 1 - Downloading PDF from: ${args.pdfUrl.substring(0, 60)}...`);

        const job = await ctx.runQuery(internal.extraction.queries.getJobInternal, { jobId: args.jobId });
        const zoteroConnection = job
          ? await ctx.runQuery(internal.zotero.internal.getConnection, { userId: job.userId })
          : null;
        const downloadResult: DownloadPdfResult = await downloadPdf(args.pdfUrl, {
          doi: args.doi,
          zoteroConnection: zoteroConnection ? { apiKey: zoteroConnection.apiKey, userId: zoteroConnection.zoteroUserId } : undefined,
        });

        if (downloadResult.success && downloadResult.pdfBlob) {
          console.log(`[processPaperAction] STEP 1 SUCCESS - PDF downloaded: ${downloadResult.pdfBlob.size} bytes`);

          pdfBlob = downloadResult.pdfBlob;

          // Store PDF
          try {
            console.log(`[processPaperAction] Storing PDF in Convex storage...`);
            storageId = await ctx.storage.store(downloadResult.pdfBlob);
            console.log(`[processPaperAction] PDF STORED - storageId: ${storageId}`);
          } catch (storageError) {
            console.error(`[processPaperAction] ERROR storing PDF:`, storageError);
          }
        } else {
          console.log(`[processPaperAction] STEP 1 FAILED - PDF download failed: ${downloadResult.error}`);
        }
      }

      if (pdfBlob) {
        try {
          console.log(`[processPaperAction] STEP 2 - Extracting text and creating chunks...`);
          const pdfBufferForExtraction = await pdfBlob.arrayBuffer();
          chunksWithMetadata = await extractAndChunkPdf(pdfBufferForExtraction, {
            maxChunkSize: 2500,
          });
          console.log(`[processPaperAction] STEP 2 COMPLETE - Extracted ${chunksWithMetadata.length} chunks`);

          if (chunksWithMetadata.length > 0) {
            console.log(`[processPaperAction] STEP 3 - Indexing ${chunksWithMetadata.length} chunks with RAG...`);
            const chunksForRag = prepareChunksForRag(chunksWithMetadata);
            const ragResult = await rag.add(ctx, {
              namespace: `extraction:${args.jobId}`,
              key: args.paperId,
              chunks: chunksForRag,
              filterValues: [{ name: "paperId", value: args.paperId }],
              metadata: {
                paperId: args.paperId,
              },
            });

            await ctx.runMutation(internal.extraction.mutations.markPaperIndexed, {
              paperId: args.paperId,
              ragEntryId: ragResult.entryId,
            });

            ragIndexed = true;
            console.log(`[processPaperAction] STEP 3 SUCCESS - RAG indexing ready for ${chunksForRag.length} chunks`);
          } else {
            console.warn(`[processPaperAction] WARNING - No chunks extracted from PDF`);
          }
        } catch (pdfError) {
          console.error(`[processPaperAction] ERROR in Step 2/3:`, pdfError);
        }
      } else {
        console.warn(`[processPaperAction] NO PDF SOURCE - Skipping PDF processing`);
      }

      // Step 4: Extract answers using AI
      console.log(`[processPaperAction] STEP 4 - Starting AI extraction for ${args.questions.length} questions...`);
      const results = [];
      let pdfContentActuallyUsed = false;

      for (const question of args.questions) {
        console.log(`[processPaperAction] Processing question: ${question.question.substring(0, 50)}...`);
        let finalChunks: Array<{ text: string; metadata: any; relevanceScore?: number }> = [];
        let pdfContentUsedForThisQuestion = false;

        if (ragIndexed && chunksWithMetadata.length > 0) {
          // Perform hybrid search with multiple query variations
          const searchResults = await performHybridSearch(
            ctx,
            `extraction:${args.jobId}`,
            question.question,
            args.paperId
          );

          if (searchResults.length > 0) {
            // Rerank chunks with LLM
            const rerankedChunks = await rerankChunksWithLLM(
              question.question,
              searchResults
            );

            // Take top 5 most relevant chunks
            finalChunks = rerankedChunks.slice(0, 5);
            pdfContentUsedForThisQuestion = true;
            pdfContentActuallyUsed = true;

            console.log(`[processPaperAction] Question "${question.question.substring(0, 40)}...": Using ${finalChunks.length} chunks (top relevance: ${finalChunks[0]?.relevanceScore?.toFixed(2) || 0})`);
          } else {
            console.log(`[processPaperAction] No chunks found for question: ${question.question.substring(0, 40)}...`);
          }
        }

        // Build enhanced extraction prompt
        const answerSchema = buildAnswerSchema(question.type);
        const prompt = buildEnhancedExtractionPrompt(
          question as ExtractionQuestion,
          args.abstract,
          finalChunks
        );

        try {
          const { object } = await generateObject({
            model: await getModel(),
            schema: answerSchema,
            prompt,
            temperature: 0.1,
          });

          results.push({
            questionKey: question.key,
            answer: object.answer,
            confidence: object.confidence,
            reasoning: object.reasoning,
            contextChunks: finalChunks.map((c) =>
              formatChunkWithMetadata({ text: c.text, metadata: c.metadata })
            ),
            pdfContentUsed: pdfContentUsedForThisQuestion,
          });
        } catch (error) {
          console.error(`[processPaperAction] Extraction failed for question ${question.key}:`, error);
          results.push({
            questionKey: question.key,
            answer: null,
            confidence: 0,
            reasoning: `Extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            contextChunks: [],
            pdfContentUsed: false,
          });
        }
      }

      const creditsUsed = Math.ceil((Date.now() - startTime) / 1000);

      console.log(`\n========================================`);
      console.log(`[processPaperAction] ACTION COMPLETED`);
      console.log(`[processPaperAction] Paper ID: ${args.paperId}`);
      console.log(`[processPaperAction] Results: ${results.length}`);
      console.log(`[processPaperAction] PDF Downloaded/Stored: ${storageId ? "YES" : "NO"}`);
      console.log(`[processPaperAction] PDF Content Used for Extraction: ${pdfContentActuallyUsed}`);
      console.log(`[processPaperAction] Storage ID: ${storageId || "NONE"}`);
      console.log(`[processPaperAction] Duration: ${creditsUsed}s`);
      console.log(`========================================\n`);

      return {
        success: true,
        paperId: args.paperId,
        results,
        creditsUsed,
        pdfUsed: pdfContentActuallyUsed,
        storageId, // Always return storageId if PDF was stored, even if not used for extraction
      };
    } catch (error) {
      console.error(`\n========================================`);
      console.error(`[processPaperAction] ACTION FAILED`);
      console.error(`[processPaperAction] Paper ID: ${args.paperId}`);
      console.error(`[processPaperAction] Error:`, error);
      console.error(`========================================\n`);
      return {
        success: false,
        paperId: args.paperId,
        error: `Processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});

// Helper functions
function buildAnswerSchema(type: string) {
  return z.object({
    answer: getZodTypeForQuestion(type),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  });
}

function getZodTypeForQuestion(type: string) {
  switch (type) {
    case "boolean":
      return z.boolean().nullable();
    case "number":
      return z.number().nullable();
    case "array":
      return z.array(z.string());
    default:
      return z.string().nullable();
  }
}

// ═══════════════════════════════════════════════════════════════
// WORKFLOW-BASED ACTIONS
// ═══════════════════════════════════════════════════════════════

interface IndexResult {
  success: boolean;
  storageId?: string;
  chunksCount?: number;
  error?: string;
}

// Step 1: Download PDF and start RAG indexing
export const downloadAndIndexPdfAction = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    pdfUrl: v.string(),
    storageId: v.optional(v.id("_storage")),
    title: v.string(),
    abstract: v.optional(v.string()),
    doi: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<IndexResult> => {
    console.log(`[downloadAndIndexPdfAction] Starting for paper ${args.paperId}`);

    if (args.storageId) {
      const stored = await ctx.storage.get(args.storageId);
      if (!stored) {
        return { success: false, error: "Stored PDF not found" };
      }

      const pdfBuffer = await stored.arrayBuffer();
      const chunksWithMetadata = await extractAndChunkPdf(pdfBuffer, {
        maxChunkSize: 2500,
      });

      if (chunksWithMetadata.length > 0) {
        const chunksForRag = prepareChunksForRag(chunksWithMetadata);
        const ragResult = await rag.add(ctx, {
          namespace: `extraction:${args.jobId}`,
          key: args.paperId,
          chunks: chunksForRag,
          filterValues: [{ name: "paperId", value: args.paperId }],
          metadata: {
            paperId: args.paperId,
          },
        });

        await ctx.runMutation(internal.extraction.mutations.markPaperIndexed, {
          paperId: args.paperId,
          ragEntryId: ragResult.entryId,
        });
      }

      if (chunksWithMetadata.length === 0) {
        return { success: true, storageId: args.storageId, chunksCount: 0 };
      }

      return { success: true, storageId: args.storageId, chunksCount: chunksWithMetadata.length };
    }

    if (!args.pdfUrl) {
      if (args.abstract && args.abstract.length > MIN_ABSTRACT_LENGTH) {
        console.log(
          `[downloadAndIndexPdfAction] No PDF URL for ${args.paperId}, using abstract only`
        );
        return { success: true, chunksCount: 0 };
      }
      return { success: false, error: "No PDF URL provided" };
    }

    try {
      // Download PDF
      console.log(`[downloadAndIndexPdfAction] Downloading PDF from: ${args.pdfUrl.substring(0, 60)}...`);
      const job = await ctx.runQuery(internal.extraction.queries.getJobInternal, { jobId: args.jobId });
      const zoteroConnection = job
        ? await ctx.runQuery(internal.zotero.internal.getConnection, { userId: job.userId })
        : null;
      const downloadResult: DownloadPdfResult = await downloadPdf(args.pdfUrl, {
        doi: args.doi,
        zoteroConnection: zoteroConnection ? { apiKey: zoteroConnection.apiKey, userId: zoteroConnection.zoteroUserId } : undefined,
      });

      if (!downloadResult.success || !downloadResult.pdfBlob) {
        console.log(`[downloadAndIndexPdfAction] Download failed: ${downloadResult.error}`);
        if (args.abstract && args.abstract.length > MIN_ABSTRACT_LENGTH) {
          return { success: true, chunksCount: 0, error: downloadResult.error };
        }
        return { success: false, error: downloadResult.error || "Download failed" };
      }

      console.log(`[downloadAndIndexPdfAction] PDF downloaded: ${downloadResult.pdfBlob.size} bytes`);

      // Store PDF
      let storageId: string | undefined;
      try {
        console.log(`[downloadAndIndexPdfAction] Storing PDF in Convex storage...`);
        storageId = await ctx.storage.store(downloadResult.pdfBlob);
        console.log(`[downloadAndIndexPdfAction] PDF stored: ${storageId}`);
        
        // Save storageId to paper
        await ctx.runMutation(internal.extraction.mutations.setPaperStorage, {
          paperId: args.paperId,
          storageId: storageId as any,
        });
      } catch (storageError) {
        console.error(`[downloadAndIndexPdfAction] Storage error:`, storageError);
        return { success: false, error: "Failed to store PDF" };
      }

      // Extract and chunk PDF
      let chunksWithMetadata: ChunkWithMetadata[] = [];
      try {
        console.log(`[downloadAndIndexPdfAction] Extracting text...`);
        const pdfBuffer = await downloadResult.pdfBlob.arrayBuffer();
        chunksWithMetadata = await extractAndChunkPdf(pdfBuffer, {
          maxChunkSize: 2500,
        });
        console.log(`[downloadAndIndexPdfAction] Extracted ${chunksWithMetadata.length} chunks`);
      } catch (chunkError) {
        console.error(`[downloadAndIndexPdfAction] Chunking error:`, chunkError);
        // Don't fail - we still have the PDF stored, can extract from abstract
        return { success: true, storageId, chunksCount: 0 };
      }

      if (chunksWithMetadata.length === 0) {
        console.log(`[downloadAndIndexPdfAction] No chunks extracted`);
        return { success: true, storageId, chunksCount: 0 };
      }

      // Start RAG indexing
      console.log(`[downloadAndIndexPdfAction] Starting RAG indexing with ${chunksWithMetadata.length} chunks`);
      const chunksForRag = prepareChunksForRag(chunksWithMetadata);
      
      const ragResult = await rag.add(ctx, {
        namespace: `extraction:${args.jobId}`,
        key: args.paperId,
        chunks: chunksForRag,
        filterValues: [{ name: "paperId", value: args.paperId }],
        metadata: {
          paperId: args.paperId,
        },
      });

      await ctx.runMutation(internal.extraction.mutations.markPaperIndexed, {
        paperId: args.paperId,
        ragEntryId: ragResult.entryId,
      });

      console.log(`[downloadAndIndexPdfAction] RAG indexing ready`);
      return { success: true, storageId, chunksCount: chunksForRag.length };

    } catch (error) {
      console.error(`[downloadAndIndexPdfAction] Error:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  },
});

// Step 2: Extract answers after indexing
export const waitAndExtractAction = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    questions: v.array(
      v.object({
        key: v.string(),
        question: v.string(),
        type: v.union(
          v.literal("string"),
          v.literal("boolean"),
          v.literal("number"),
          v.literal("array")
        ),
        description: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    results?: Array<{
      questionKey: string;
      answer: any;
      confidence?: number;
      reasoning?: string;
      contextChunks?: string[];
      pdfContentUsed?: boolean;
    }>;
    creditsUsed?: number;
    pdfContentUsed?: boolean;
    error?: string;
  }> => {
    const startTime = Date.now();
    console.log(`[waitAndExtractAction] Starting for paper ${args.paperId}`);

    try {
      // Step 2a: Get paper details for extraction
      const paper = await ctx.runQuery(
        internal.extraction.queries.getPaperInternal,
        { paperId: args.paperId }
      );

      if (!paper) {
        return { success: false, error: "Paper not found" };
      }

      // Step 2b: Extract answers
      const results = [];
      let pdfContentActuallyUsed = false;
      const isIndexed = !!paper.isIndexed || !!paper.ragEntryId;

      if (!isIndexed) {
        console.log(`[waitAndExtractAction] Not indexed, using abstract only`);
      }

      for (const question of args.questions) {
        console.log(`[waitAndExtractAction] Processing: ${question.question.substring(0, 50)}...`);
        
        let finalChunks: Array<{ text: string; metadata: any; relevanceScore?: number }> = [];
        let pdfContentUsedForThisQuestion = false;

        if (isIndexed) {
          // Perform hybrid search
          const searchResults = await performHybridSearch(
            ctx,
            `extraction:${args.jobId}`,
            question.question,
            args.paperId
          );

          if (searchResults.length > 0) {
            // Rerank chunks
            const rerankedChunks = await rerankChunksWithLLM(
              question.question,
              searchResults
            );

            finalChunks = rerankedChunks.slice(0, 5);
            pdfContentUsedForThisQuestion = true;
            pdfContentActuallyUsed = true;

            console.log(`[waitAndExtractAction] Using ${finalChunks.length} chunks`);
          }
        }

        // Build extraction prompt
        const answerSchema = buildAnswerSchema(question.type);
        const prompt = buildEnhancedExtractionPrompt(
          question as ExtractionQuestion,
          paper.abstract,
          finalChunks
        );

        try {
          const { object } = await generateObject({
            model: await getModel(),
            schema: answerSchema,
            prompt,
            temperature: 0.1,
          });

          results.push({
            questionKey: question.key,
            answer: object.answer,
            confidence: object.confidence,
            reasoning: object.reasoning,
            contextChunks: finalChunks.map((c) =>
              formatChunkWithMetadata({ text: c.text, metadata: c.metadata })
            ),
            pdfContentUsed: pdfContentUsedForThisQuestion,
          });
        } catch (error) {
          console.error(`[waitAndExtractAction] Extraction failed for ${question.key}:`, error);
          results.push({
            questionKey: question.key,
            answer: null,
            confidence: 0,
            reasoning: `Extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            contextChunks: [],
            pdfContentUsed: false,
          });
        }
      }

      const creditsUsed = Math.ceil((Date.now() - startTime) / 1000);
      
      console.log(`[waitAndExtractAction] Complete - ${results.length} results, PDF used: ${pdfContentActuallyUsed}`);
      
      return {
        success: true,
        results,
        creditsUsed,
        pdfContentUsed: pdfContentActuallyUsed,
      };

    } catch (error) {
      console.error(`[waitAndExtractAction] Error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
