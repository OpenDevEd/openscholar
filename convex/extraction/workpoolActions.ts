"use node";

/**
 * Extraction Actions using Workpool pattern with Hybrid RAG
 * Implements multi-query search + LLM reranking for better PDF content extraction
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { getModel } from "../ai/helpers";
import { downloadPdf, type DownloadPdfResult } from "../../lib/pdf/download";
import {
  extractAndChunkPdf,
  type ChunkWithMetadata,
  formatChunkWithMetadata,
} from "./chunking";
import {
  buildEnhancedExtractionPrompt,
  buildRerankingPrompt,
  buildQueryExpansionPrompt,
  detectQuestionType,
  type ExtractionQuestion,
} from "./prompts";

// Initialize RAG
const rag = new RAG(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
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
  maxRetries: number = 10
): Promise<Array<{ text: string; metadata: any }>> {
  const questionType = detectQuestionType(question);
  console.log(`[performHybridSearch] Question type: ${questionType}`);

  // Generate query variations
  const queryVariations = await generateQueryVariations(question, questionType);
  console.log(`[performHybridSearch] Using ${queryVariations.length} query variations`);

  // Collect results from all queries
  const allResults: Array<{ text: string; metadata: any; hash: string }> = [];
  const seenHashes = new Set<string>();

  // Run searches with retry logic
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let foundNewResults = false;

    for (const query of queryVariations) {
      try {
        const searchResults = await rag.search(ctx, {
          namespace,
          query,
          limit: 10, // Get more results initially for reranking
        });

        if (searchResults.results.length > 0) {
          for (const result of searchResults.results) {
            // Each result has content array with chunks
            for (const chunk of result.content) {
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`[performHybridSearch] Found ${allResults.length} unique chunks`);
  return allResults.map(({ text, metadata }) => ({ text, metadata }));
}

// Process single paper - NO internal calls allowed
export const processPaperAction = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    jobId: v.id("extractionJobs"),
    pdfUrl: v.string(),
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

    try {
      console.log(`[processPaperAction] Processing paper ${args.paperId}: ${args.title}`);
      console.log(`[processPaperAction] PDF URL available: ${!!args.pdfUrl}, Abstract available: ${!!args.abstract}`);

      let chunksWithMetadata: ChunkWithMetadata[] = [];
      let storageId: string | undefined;
      let ragIndexed = false;

      // Step 1: Try to download and process PDF if URL is available
      if (args.pdfUrl) {
        console.log(`[processPaperAction] Attempting to download PDF from: ${args.pdfUrl.substring(0, 60)}...`);

        const downloadResult: DownloadPdfResult = await downloadPdf(args.pdfUrl, {
          doi: args.doi,
        });

        if (downloadResult.success && downloadResult.pdfData) {
          console.log(`[processPaperAction] PDF downloaded successfully (${downloadResult.pdfData.byteLength} bytes)`);

          // Store PDF
          try {
            const blob = new Blob([downloadResult.pdfData]);
            storageId = await ctx.storage.store(blob);
            console.log(`[processPaperAction] PDF stored with storageId: ${storageId}`);
          } catch (storageError) {
            console.error(`[processPaperAction] Failed to store PDF:`, storageError);
          }

          // Extract and chunk PDF with metadata
          try {
            const pdfBufferForExtraction = new Uint8Array(downloadResult.pdfData).slice().buffer;

            chunksWithMetadata = await extractAndChunkPdf(pdfBufferForExtraction, {
              maxChunkSize: 2500,
            });

            console.log(`[processPaperAction] Extracted ${chunksWithMetadata.length} chunks with metadata`);

            if (chunksWithMetadata.length > 0) {
              // Index chunks with RAG - use custom chunks
              const chunksForRag = chunksWithMetadata.map((chunk) => chunk.text);
              
              // Note: We're using the chunks directly. The RAG component will embed them.
              // We need to store metadata separately and retrieve it during search
              await rag.add(ctx, {
                namespace: `extraction:${args.jobId}`,
                key: args.paperId,
                chunks: chunksForRag,
              });
              
              ragIndexed = true;
              console.log(`[processPaperAction] RAG indexed ${chunksForRag.length} chunks for paper ${args.paperId}`);
            } else {
              console.warn(`[processPaperAction] No chunks extracted from PDF`);
            }
          } catch (pdfError) {
            console.error(`[processPaperAction] PDF extraction error:`, pdfError);
          }
        } else {
          console.log(`[processPaperAction] PDF download failed: ${downloadResult.error}`);
        }
      } else {
        console.warn(`[processPaperAction] SKIPPING PDF: No PDF URL provided`);
      }

      // Step 2: Extract answers using AI with hybrid search
      const results = [];
      let pdfContentActuallyUsed = false;

      for (const question of args.questions) {
        let finalChunks: Array<{ text: string; metadata: any; relevanceScore?: number }> = [];
        let pdfContentUsedForThisQuestion = false;

        if (ragIndexed && chunksWithMetadata.length > 0) {
          // Perform hybrid search with multiple query variations
          const searchResults = await performHybridSearch(
            ctx,
            `extraction:${args.jobId}`,
            question.question,
            10
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

      console.log(`[processPaperAction] Completed paper ${args.paperId} with ${results.length} results, PDF content used: ${pdfContentActuallyUsed}`);

      return {
        success: true,
        paperId: args.paperId,
        results,
        creditsUsed,
        pdfUsed: pdfContentActuallyUsed, // Only true if PDF content was actually used in extraction
      };
    } catch (error) {
      console.error(`[processPaperAction] Fatal error processing paper ${args.paperId}:`, error);
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
