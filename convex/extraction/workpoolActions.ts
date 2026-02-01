"use node";

/**
 * Extraction Actions using Workpool pattern
 * Actions cannot call ctx.runQuery/runMutation in self-hosted mode
 * All DB updates must happen in defineOnComplete handlers
 */

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "../ai/helpers";
import { downloadPdf, type DownloadPdfResult } from "../../lib/pdf/download";

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
  }>;
  error?: string;
  creditsUsed?: number;
  pdfUsed?: boolean;
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

      let pdfText: string | undefined;
      let storageId: string | undefined;
      let ragIndexed = false;

      // Step 1: Try to download and process PDF if URL is available
      if (args.pdfUrl) {
        console.log(`[processPaperAction] Attempting to download PDF from: ${args.pdfUrl.substring(0, 60)}...`);
        
        // Use the robust download utility with retries and alternative sources
        const downloadResult: DownloadPdfResult = await downloadPdf(args.pdfUrl, {
          doi: args.doi,
        });

        if (downloadResult.success && downloadResult.pdfData) {
          console.log(`[processPaperAction] PDF downloaded successfully (${downloadResult.pdfData.byteLength} bytes)`);
          
          // Store PDF (optional, don't fail if it fails)
          try {
            const blob = new Blob([downloadResult.pdfData]);
            storageId = await ctx.storage.store(blob);
            console.log(`[processPaperAction] PDF stored with storageId: ${storageId}`);
          } catch (storageError) {
            console.error(`[processPaperAction] Failed to store PDF:`, storageError);
            // Continue without storageId
          }

          // Extract and Index Text (Critical for RAG)
          try {
            // Clone buffer for extraction since unpdf might detach it/use it
            const pdfBufferForExtraction = new Uint8Array(downloadResult.pdfData).slice().buffer;
            
            // Step 2: Extract text from PDF
            const { extractText } = await import("unpdf");
            const extracted = await extractText(pdfBufferForExtraction);
            pdfText = Array.isArray(extracted.text)
              ? extracted.text.join("\n\n")
              : String(extracted.text || "");

            console.log(`[processPaperAction] Extracted text length: ${pdfText.length} chars`);
            
            if (pdfText && pdfText.length >= 100) {
              // Step 4: Index full text with RAG
              await rag.add(ctx, {
                namespace: `extraction:${args.jobId}`,
                key: args.paperId,
                text: pdfText,
              });
              ragIndexed = true;
              console.log(`[processPaperAction] RAG indexed paper ${args.paperId}`);
            } else {
              console.warn(`[processPaperAction] PDF text too short (${pdfText?.length || 0} chars), skipping RAG`);
            }
          } catch (pdfError) {
            console.error(`[processPaperAction] PDF text extraction error:`, pdfError);
            // Continue with abstract-only processing
          }
        } else {
          console.log(`[processPaperAction] PDF download failed: ${downloadResult.error}`);
        }
      } else {
         console.warn(`[processPaperAction] SKIPPING PDF: No PDF URL provided`);
      }

      // Step 5: Extract answers using AI (with or without PDF content)
      const results = [];

      for (const question of args.questions) {
        let contextText = "";
        let contextChunks: string[] = [];

        if (ragIndexed && pdfText) {
          // Search RAG for context from PDF
          // Retry loop: RAG indexing is async, so we poll for a few seconds if no results found
          const maxRetries = 10;
          const retryDelay = 1000;
          
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const searchResults = await rag.search(ctx, {
                namespace: `extraction:${args.jobId}`,
                query: question.question,
                limit: 5,
              });

              if (searchResults.results.length > 0) {
                 // Use context.text which combines all relevant chunks
                contextText = searchResults.text || "";
                contextChunks = searchResults.results.map((r: any) =>
                  typeof r === "string" ? r : r.text || ""
                );
                console.log(`[processPaperAction] RAG check ${attempt}: Found ${searchResults.results.length} results.`);
                break; // Success
              } else {
                 console.log(`[processPaperAction] RAG check ${attempt}: No results yet.`);
              }
            } catch (ragError) {
               console.error(`[processPaperAction] RAG search failed:`, ragError);
            }
            
            // Wait before retry if not last attempt
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
          }
        }
        // Build extraction prompt with both abstract and PDF content
        const answerSchema = buildAnswerSchema(question.type);
        const prompt = buildExtractionPrompt(
          question,
          args.abstract,
          contextText,
          contextChunks
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
            contextChunks: contextChunks.slice(0, 3),
          });
        } catch (error) {
          results.push({
            questionKey: question.key,
            answer: null,
            confidence: 0,
            reasoning: `Extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            contextChunks: [],
          });
        }
      }

      const creditsUsed = Math.ceil((Date.now() - startTime) / 1000);

      console.log(`[processPaperAction] Completed paper ${args.paperId} with ${results.length} results`);

      return {
        success: true,
        paperId: args.paperId,
        results,
        creditsUsed,
        pdfUsed: ragIndexed, // Only true if RAG was actually indexed
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

function buildExtractionPrompt(
  question: {
    key: string;
    question: string;
    type: string;
    description?: string;
  },
  abstract: string | undefined,
  contextText: string,
  contextChunks: string[]
): string {
  let prompt = `You are an expert research assistant extracting data from academic papers.\n\n`;

  // Add abstract if available
  if (abstract) {
    prompt += `ABSTRACT:\n${abstract}\n\n`;
  }

  // Add PDF content if available
  if (contextText) {
    prompt += `RELEVANT PASSAGES FROM THE FULL PAPER:\n${contextChunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join("\n\n")}\n\n`;
  }

  prompt += `QUESTION: ${question.question}\n`;
  if (question.description) {
    prompt += `CONTEXT: ${question.description}\n`;
  }
  prompt += `TYPE: ${question.type} (respond with appropriate type)\n\n`;

  prompt += `INSTRUCTIONS:\n`;
  if (abstract && contextText) {
    prompt += `1. Answer based on BOTH the abstract and the full paper passages provided\n`;
  } else if (abstract) {
    prompt += `1. Answer based on the abstract provided (full paper not available)\n`;
  } else if (contextText) {
    prompt += `1. Answer based on the full paper passages provided\n`;
  } else {
    prompt += `1. No content available - respond with null\n`;
  }
  prompt += `2. If the information is not found, respond with null\n`;
  prompt += `3. Be concise and factual\n`;
  prompt += `4. For boolean questions: true = yes, false = no, null = not found/unclear\n`;
  prompt += `5. For array questions: return a list of distinct items\n`;
  prompt += `6. Provide a confidence score (0-1) and brief reasoning\n\n`;
  prompt += `Respond in valid JSON format.`;

  return prompt;
}
