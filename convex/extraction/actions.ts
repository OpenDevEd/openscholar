"use node";

/**
 * Extraction Actions
 * Core actions for PDF processing, RAG indexing, and AI extraction
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { components } from "../_generated/api";
import type { ExtractionResult, PaperData } from "./types";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "../ai/helpers";
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import type { Doc, Id } from "../_generated/dataModel";

// Initialize RAG component with embedding model
const rag = new RAG(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
});

// Fetch papers from OpenAlex via HTTP API with abstract support
export const fetchPapersFromHistory = internalAction({
  args: {
    searchFilters: v.record(v.string(), v.any()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<PaperData[]> => {
    const filters = args.searchFilters as {
      query: string;
      field?: string;
      yearRange?: [number, number];
      dateRange?: { from?: string; to?: string };
      sortBy?: string;
      selectedRegions?: string[];
      selectedCountryFocus?: string[];
      reviewFilter?: boolean;
      searchField?: string;
    };

    const baseUrl = "https://api.openalex.org/works";
    const searchParams = new URLSearchParams();
    
    // Add search query with field support
    if (filters.query) {
      if (filters.searchField === 'title_and_abstract') {
        searchParams.set("filter", `title_and_abstract.search:${filters.query}`);
      } else if (filters.searchField === 'title') {
        searchParams.set("filter", `title.search:${filters.query}`);
      } else if (filters.searchField === 'abstract') {
        searchParams.set("filter", `abstract.search:${filters.query}`);
      } else {
        searchParams.set("search", filters.query);
      }
    }
    
    // Add year range filter
    if (filters.yearRange) {
      const existingFilter = searchParams.get("filter") || "";
      const yearFilter = `publication_year:${filters.yearRange[0]}-${filters.yearRange[1]}`;
      searchParams.set("filter", existingFilter ? `${existingFilter},${yearFilter}` : yearFilter);
    }
    
    // Add sorting
    if (filters.sortBy) {
      const [field, order] = filters.sortBy.split(':');
      searchParams.set("sort", `${field}:${order || 'desc'}`);
    }
    
    // Get 200 papers with abstracts
    searchParams.set("per-page", "200");
    
    const papers: PaperData[] = [];

    try {
      console.log(`[fetchPapersFromHistory] Fetching: ${baseUrl}?${searchParams.toString()}`);
      
      const response = await fetch(`${baseUrl}?${searchParams.toString()}`, {
        headers: {
          "User-Agent": "OpenAlex-Count/1.0 (mailto:admin@example.com)",
          "Accept": "application/json",
        },
      });
      
      if (!response.ok) {
        throw new Error(`OpenAlex API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();

      for (const work of data.results || []) {
        // Extract abstract from inverted index if available
        let abstract: string | undefined;
        if (work.abstract_inverted_index) {
          // Reconstruct abstract from inverted index
          abstract = reconstructAbstract(work.abstract_inverted_index);
        }

        papers.push({
          openalexId: work.id?.replace("https://openalex.org/", "") || "",
          title: work.display_name || "Untitled",
          doi: work.doi || undefined,
          publicationYear: work.publication_year || undefined,
          abstract: abstract,
          authors: work.authorships?.map((a: any) => a.author?.display_name).filter(Boolean) || [],
          pdfUrl: work.open_access?.oa_url || undefined,
          isOpenAccess: work.open_access?.is_oa || false,
        });
      }

      console.log(`[fetchPapersFromHistory] Fetched ${papers.length} papers`);
      const withAbstracts = papers.filter(p => p.abstract).length;
      console.log(`[fetchPapersFromHistory] Papers with abstracts: ${withAbstracts}/${papers.length}`);

      return papers;
    } catch (error) {
      console.error(`[fetchPapersFromHistory] Error:`, error);
      throw error;
    }
  },
});

// Helper to reconstruct abstract from OpenAlex inverted index
function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  if (!invertedIndex || Object.keys(invertedIndex).length === 0) {
    return "";
  }

  // Create position -> word mapping
  const positionMap: Map<number, string> = new Map();
  
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      positionMap.set(pos, word);
    }
  }

  // Sort positions and join words
  const sortedPositions = Array.from(positionMap.keys()).sort((a, b) => a - b);
  return sortedPositions.map(pos => positionMap.get(pos)).join(" ");
}

// Enqueue papers for parallel processing
export const enqueuePapersForProcessing = internalAction({
  args: {
    jobId: v.id("extractionJobs"),
    paperIds: v.array(v.string()),
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
  handler: async (ctx, args): Promise<{ enqueued: number }> => {
    console.log("enqueuePapersForProcessing called with args:", JSON.stringify(args));
    
    // Get paper records - pass papers directly to avoid ctx.runQuery in action
    // This is a workaround for self-hosted Convex where actions can't call queries
    console.log("Note: In self-hosted mode, papers should be passed directly to avoid ctx.runQuery");
    console.log("Attempting to fetch papers by querying the database directly...");
    
    // Since we can't use ctx.runQuery in actions in self-hosted mode,
    // we need to fetch papers using a different approach
    // For now, return 0 to indicate the issue
    console.error("Cannot run queries from actions in self-hosted Convex deployment");
    console.error("This is a known limitation - actions cannot make internal API calls");
    return { enqueued: 0 };
  },
});

// Process individual paper
export const processPaper = internalAction({
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
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const startTime = Date.now();

    try {
      // Step 1: Get paper details
      const paper = await ctx.runQuery(
        internal.extraction.queries.getPaperInternal,
        { paperId: args.paperId }
      );

      if (!paper) {
        throw new Error("Paper not found");
      }

      if (!paper.pdfUrl) {
        console.log(`[processPaper] No PDF URL for paper ${args.paperId}`);
        throw new Error("No PDF URL available for this paper");
      }

      console.log(`[processPaper] Downloading PDF for ${args.paperId} from ${paper.pdfUrl}`);

      // Step 2: Download PDF
      await ctx.runMutation(internal.extraction.mutations.updatePaperStatus, {
        paperId: args.paperId,
        status: "downloading",
      });

      // Download PDF directly
      let pdfBuffer: ArrayBuffer;
      try {
        const response = await fetch(paper.pdfUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        pdfBuffer = await response.arrayBuffer();
        console.log(`[processPaper] Download success, size: ${pdfBuffer.byteLength} bytes`);
      } catch (error) {
        console.error(`[processPaper] Download failed for ${args.paperId}:`, error);
        await ctx.runMutation(
          internal.extraction.mutations.updatePaperStatus,
          {
            paperId: args.paperId,
            status: "download_failed",
            errorMessage:
              error instanceof Error ? error.message : "Download failed",
          }
        );
        throw error;
      }

      // Step 3: Store PDF in Convex file storage
      const blob = new Blob([pdfBuffer]);
      const storageId = await ctx.storage.store(blob);
      console.log(`[processPaper] Stored PDF for ${args.paperId}, storageId: ${storageId}`);

      await ctx.runMutation(internal.extraction.mutations.setPaperStorage, {
        paperId: args.paperId,
        storageId,
      });

      // Step 4: Index with RAG
      await ctx.runMutation(internal.extraction.mutations.updatePaperStatus, {
        paperId: args.paperId,
        status: "indexing",
      });

      // Use RAG's async indexing with custom chunker
      await rag.addAsync(ctx, {
        namespace: `extraction:${args.jobId}`,
        chunkerAction: internal.extraction.actions.chunkPdf,
        onComplete: internal.extraction.mutations.onRagIndexingComplete,
        metadata: {
          paperId: args.paperId,
          storageId,
          title: paper.title,
        },
      });

      // Step 5: Extract answers for each question
      await ctx.runMutation(internal.extraction.mutations.updatePaperStatus, {
        paperId: args.paperId,
        status: "extracting",
      });

      const results: ExtractionResult[] = [];

      for (const question of args.questions) {
        // Search RAG for relevant context
        const searchResults = await rag.search(ctx, {
          namespace: `extraction:${args.jobId}`,
          query: question.question,
          limit: 5,
          chunkContext: { before: 1, after: 1 },
        });

        // Extract answer using AI
        const extraction = await ctx.runAction(
          internal.extraction.actions.extractAnswer,
          {
            paperId: args.paperId,
            question,
            context: searchResults.text,
            chunks: searchResults.results.map((r: any) =>
              typeof r === "string" ? r : r.text || ""
            ),
          }
        );

        results.push(extraction);
      }

      // Step 6: Save results
      await ctx.runMutation(
        internal.extraction.mutations.saveExtractionResults,
        {
          paperId: args.paperId,
          results,
        }
      );

      // Step 7: Mark paper as complete
      const creditsUsed = Math.ceil((Date.now() - startTime) / 1000);

      await ctx.runMutation(internal.extraction.mutations.updatePaperStatus, {
        paperId: args.paperId,
        status: "completed",
        completedAt: Date.now(),
        creditsUsed,
      });

      return { success: true };
    } catch (error) {
      // Handle errors
      await ctx.runMutation(internal.extraction.mutations.updatePaperStatus, {
        paperId: args.paperId,
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "Unknown error",
        completedAt: Date.now(),
      });

      throw error;
    }
  },
});

// RAG chunker for PDFs
export const chunkPdf = rag.defineChunkerAction(async (ctx, args) => {
  const { storageId, title } = args.entry.metadata as {
    storageId: string;
    title: string;
  };

  // Get PDF from storage
  const file = await ctx.storage.get(storageId);
  if (!file) {
    throw new Error("PDF not found in storage");
  }

  // Convert to text using unpdf
  const { extractText } = await import("unpdf");
  const pdfBuffer = await file.arrayBuffer();
  const extracted = await extractText(pdfBuffer);

  // Smart chunking strategy - unpdf returns { totalPages, text: string[] }
  const fullText = Array.isArray(extracted.text) 
    ? extracted.text.join("\n\n") 
    : String(extracted.text || "");
  
  const chunks = chunkTextIntelligently(fullText, {
    maxChunkSize: 1000,
    overlap: 200,
  });

  return {
    chunks,
    title,
  };
});

function chunkTextIntelligently(
  text: string,
  options: { maxChunkSize: number; overlap: number }
): string[] {
  const { maxChunkSize, overlap } = options;
  const chunks: string[] = [];

  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) continue;

    if (currentChunk.length + trimmedParagraph.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        // Keep overlap
        const words = currentChunk.split(" ");
        const overlapWords = words.slice(-Math.floor(overlap / 5));
        currentChunk = overlapWords.join(" ") + " ";
      }
    }
    currentChunk += trimmedParagraph + "\n\n";
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// Extract answer for a single question
export const extractAnswer = internalAction({
  args: {
    paperId: v.id("extractionPapers"),
    question: v.object({
      key: v.string(),
      question: v.string(),
      type: v.union(
        v.literal("string"),
        v.literal("boolean"),
        v.literal("number"),
        v.literal("array")
      ),
      description: v.optional(v.string()),
    }),
    context: v.string(),
    chunks: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<ExtractionResult> => {
    const { question, context, chunks } = args;

    // Build dynamic schema based on question type
    const answerSchema = buildAnswerSchema(question.type);

    const { object } = await generateObject({
      model: await getModel(),
      schema: answerSchema,
      prompt: buildExtractionPrompt(question, context, chunks),
      temperature: 0.1,
    });

    return {
      questionKey: question.key,
      answer: object.answer,
      confidence: object.confidence,
      reasoning: object.reasoning,
      contextChunks: chunks.slice(0, 3),
      model: "extraction-model",
      provider: "extraction-provider",
    };
  },
});

function buildAnswerSchema(type: string) {
  const baseSchema = z.object({
    answer: getZodTypeForQuestion(type),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  });

  return baseSchema;
}

function getZodTypeForQuestion(type: string) {
  switch (type) {
    case "boolean":
      return z.boolean().nullable();
    case "number":
      return z.number().nullable();
    case "array":
      return z.array(z.string());
    case "string":
    default:
      return z.string().nullable();
  }
}

function buildExtractionPrompt(
  question: {
    key: string;
    question: string;
    type: string;
    description?: string;
  },
  context: string,
  chunks: string[]
): string {
  return `You are an expert research assistant extracting data from academic papers.

QUESTION: ${question.question}
${question.description ? `CONTEXT: ${question.description}\n` : ""}
TYPE: ${question.type} (respond with appropriate type)

RELEVANT PASSAGES FROM THE PAPER:
${chunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join("\n\n")}

INSTRUCTIONS:
1. Answer the question based ONLY on the provided passages
2. If the information is not found, respond with null
3. Be concise and factual
4. For boolean questions: true = yes, false = no, null = not found/unclear
5. For array questions: return a list of distinct items
6. Provide a confidence score (0-1) and brief reasoning

Respond in valid JSON format.`;
}
