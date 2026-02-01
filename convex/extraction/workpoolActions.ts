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

// PDF Download utility functions (inlined from lib/pdf/download.ts for Convex compatibility)
interface DownloadPdfResult {
  success: boolean;
  pdfData?: ArrayBuffer;
  error?: string;
}

async function downloadPdf(url: string, doi?: string): Promise<DownloadPdfResult> {
  const maxRetries = 3;
  const timeout = 30000;

  try {
    // Try direct download first
    const result = await tryDownload(url, maxRetries, timeout);
    if (result.success) {
      return result;
    }

    // If DOI provided, try alternative OA URLs
    if (doi && !result.success) {
      const alternativeUrls = await fetchAlternativeOaUrls(doi);
      for (const altUrl of alternativeUrls.slice(0, 2)) {
        console.log(`[PDF Download] Trying alternative: ${altUrl.substring(0, 60)}...`);
        const altResult = await tryDownload(altUrl, maxRetries, timeout);
        if (altResult.success) {
          return altResult;
        }
      }
    }

    return result;
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, error };
  }
}

async function tryDownload(url: string, maxRetries: number, timeout: number): Promise<DownloadPdfResult> {
  let lastError = "";
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/pdf,application/x-pdf,*/*",
        },
      });
      
      clearTimeout(timeoutId);

      if (response.status === 403) {
        lastError = "Access forbidden (403)";
        await sleep(2000 * (attempt + 1)); // Exponential backoff
        continue;
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        await sleep(1000 * (attempt + 1));
        continue;
      }

      const pdfData = await response.arrayBuffer();
      
      // Verify it's a PDF by checking magic bytes
      const bytes = new Uint8Array(pdfData.slice(0, 5));
      const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
      
      if (!isPdf && pdfData.byteLength < 1000) {
        lastError = "Downloaded content is not a valid PDF";
        continue;
      }

      return { success: true, pdfData };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < maxRetries - 1) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  return { success: false, error: lastError || "Download failed after all retries" };
}

async function fetchAlternativeOaUrls(doi: string): Promise<string[]> {
  const urls: string[] = [];
  
  // Try Unpaywall API
  try {
    const response = await fetch(`https://api.unpaywall.org/v2/${doi}?email=user@example.com`, {
      headers: { "User-Agent": "OpenAlex-Count/1.0" },
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.best_oa_location?.url_for_pdf) {
        urls.push(data.best_oa_location.url_for_pdf);
      }
    }
  } catch (e) {
    // Unpaywall failed, continue
  }

  return urls;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
        const downloadResult: DownloadPdfResult = await downloadPdf(args.pdfUrl, args.doi);

        if (downloadResult.success && downloadResult.pdfData) {
          console.log(`[processPaperAction] PDF downloaded successfully (${downloadResult.pdfData.byteLength} bytes)`);
          
          // Store PDF immediately
          try {
            const blob = new Blob([downloadResult.pdfData]);
            storageId = await ctx.storage.store(blob);
            console.log(`[processPaperAction] PDF stored with storageId: ${storageId}`);
          } catch (storageError) {
            console.error(`[processPaperAction] Failed to store PDF:`, storageError);
            // Continue, but we won't have a storageId
          }

          if (storageId) {
             try {
                // Clone buffer for extraction since unpdf might detach it
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
                // Continue with abstract-only processing, but we HAVE the PDF stored
             }
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
          const searchResults = await rag.search(ctx, {
            namespace: `extraction:${args.jobId}`,
            query: question.question,
            limit: 5,
          });

          // Use context.text which combines all relevant chunks
          contextText = searchResults.text || "";
          contextChunks = searchResults.results.map((r: any) =>
            typeof r === "string" ? r : r.text || ""
          );
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
