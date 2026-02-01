"use node";

/**
 * Sequential Paper Processing
 * Process papers one by one within the workflow to avoid action limitations
 */

import { action, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { components } from "../_generated/api";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "../ai/helpers";
import { RAG } from "@convex-dev/rag";
import { openai } from "@ai-sdk/openai";
import type { Doc, Id } from "../_generated/dataModel";
import type { ExtractionResult } from "./types";

// Initialize RAG component with embedding model
const rag = new RAG(components.rag, {
  textEmbeddingModel: openai.embedding("text-embedding-3-small"),
  embeddingDimension: 1536,
});

// Download and process a single paper - NO internal calls, only external APIs
export const downloadAndProcessPdf = internalAction({
  args: {
    pdfUrl: v.string(),
  },
  handler: async (ctx, args): Promise<{ text: string; chunks: string[] } | null> => {
    try {
      // Download PDF
      const response = await fetch(args.pdfUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        console.error(`Failed to download PDF: ${response.status}`);
        return null;
      }

      const pdfBuffer = await response.arrayBuffer();

      // Extract text
      const { extractText } = await import("unpdf");
      const extracted = await extractText(pdfBuffer);

      console.log(`[downloadAndProcessPdf] Extracted ${extracted.totalPages} pages`);
      
      // Process by pages with validation and simple chunking
      const chunks: string[] = [];
      
      for (let pageNum = 0; pageNum < extracted.text.length; pageNum++) {
        const pageText = extracted.text[pageNum];
        
        // Validate page text
        if (typeof pageText !== 'string') {
          console.warn(`[downloadAndProcessPdf] Page ${pageNum + 1}: Invalid type ${typeof pageText}`);
          continue;
        }
        
        if (pageText.trim().length < 50) {
          console.log(`[downloadAndProcessPdf] Page ${pageNum + 1}: Too short (${pageText.length} chars)`);
          continue;
        }
        
        // Simple paragraph-based chunking
        const paragraphs = pageText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        let currentChunk = "";
        
        for (const paragraph of paragraphs) {
          const trimmed = paragraph.trim();
          if (!trimmed) continue;
          
          if (currentChunk.length + trimmed.length > 1000 && currentChunk.length > 200) {
            chunks.push(currentChunk.trim());
            // Overlap: keep last 40 words
            const words = currentChunk.split(" ");
            currentChunk = words.slice(-40).join(" ") + "\n\n" + trimmed + "\n\n";
          } else {
            currentChunk += trimmed + "\n\n";
          }
        }
        
        if (currentChunk.trim().length > 100) {
          chunks.push(currentChunk.trim());
        }
      }
      
      const fullText = Array.isArray(extracted.text)
        ? extracted.text.join("\n\n")
        : String(extracted.text || "");
      
      console.log(`[downloadAndProcessPdf] Created ${chunks.length} chunks`);
      return { text: fullText, chunks };
    } catch (error) {
      console.error("PDF processing error:", error);
      return null;
    }
  },
});

// Extract answers using AI - NO internal calls, only external API
export const extractWithAI = internalAction({
  args: {
    question: v.string(),
    questionType: v.union(
      v.literal("string"),
      v.literal("boolean"),
      v.literal("number"),
      v.literal("array")
    ),
    description: v.optional(v.string()),
    context: v.string(),
    chunks: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<ExtractionResult | null> => {
    try {
      const answerSchema = buildAnswerSchema(args.questionType);

      const prompt = `You are an expert research assistant extracting data from academic papers.

QUESTION: ${args.question}
${args.description ? `CONTEXT: ${args.description}\n` : ""}
TYPE: ${args.questionType} (respond with appropriate type)

RELEVANT PASSAGES FROM THE PAPER:
${args.chunks.map((chunk, i) => `[${i + 1}] ${chunk}`).join("\n\n")}

INSTRUCTIONS:
1. Answer the question based ONLY on the provided passages
2. If the information is not found, respond with null
3. Be concise and factual
4. For boolean questions: true = yes, false = no, null = not found/unclear
5. For array questions: return a list of distinct items
6. Provide a confidence score (0-1) and brief reasoning

Respond in valid JSON format.`;

      const { object } = await generateObject({
        model: await getModel(),
        schema: answerSchema,
        prompt,
        temperature: 0.1,
      });

      return {
        questionKey: "", // Will be set by caller
        answer: object.answer,
        confidence: object.confidence,
        reasoning: object.reasoning,
        contextChunks: args.chunks.slice(0, 3),
      };
    } catch (error) {
      console.error("AI extraction error:", error);
      return null;
    }
  },
});

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

// Store PDF blob in Convex storage
export const storePdfBlob = internalAction({
  args: {
    blob: v.any(), // Blob data
  },
  handler: async (ctx, args): Promise<Id<"_storage">> => {
    const storageId = await ctx.storage.store(args.blob);
    return storageId as Id<"_storage">;
  },
});

// Index chunks with RAG
export const indexWithRag = internalAction({
  args: {
    jobId: v.id("extractionJobs"),
    paperId: v.id("extractionPapers"),
    text: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await rag.add(ctx, {
      namespace: `extraction:${args.jobId}`,
      key: args.paperId,
      text: args.text,
    });
  },
});
