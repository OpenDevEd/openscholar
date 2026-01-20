/**
 * RAG (Retrieval-Augmented Generation) module for document extraction.
 * 
 * This module provides:
 * - Text chunking and embedding for PDFs and abstracts
 * - Semantic search for relevant context during extraction
 * - Per-analysis namespacing for isolated knowledge bases
 * 
 * Embedding Provider:
 * - Uses OpenAI text-embedding-3-small if OPENAI_API_KEY is set
 * - Falls back to local Ollama nomic-embed-text if no OpenAI key
 */

import { RAG } from "@convex-dev/rag";
import { components } from "../_generated/api";
import { openai } from "@ai-sdk/openai";
import { 
  createOllamaEmbeddingModel, 
  getOllamaEmbeddingDimension 
} from "./ollamaEmbedding";

// Filter types for the RAG component
type FilterTypes = {
  analysisId: string;
  documentId: string;
  contentType: "abstract" | "fulltext" | "chunk";
};

// Metadata stored with each RAG entry
type Metadata = {
  documentId: string;
  analysisId: string;
  title: string;
  contentType: "abstract" | "fulltext" | "chunk";
  chunkIndex?: number;
  totalChunks?: number;
};

// Default Ollama model for embeddings
const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";

/**
 * Determine which embedding model to use based on environment.
 * 
 * - OpenAI text-embedding-3-small: 1536 dimensions (requires OPENAI_API_KEY)
 * - Ollama nomic-embed-text: 768 dimensions (requires local Ollama server)
 */
function getEmbeddingConfig(): {
  model: any;
  dimension: number;
  provider: "openai" | "ollama";
} {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  
  if (hasOpenAI) {
    console.log("[RAG] Using OpenAI text-embedding-3-small for embeddings");
    return {
      model: openai.embedding("text-embedding-3-small"),
      dimension: 1536,
      provider: "openai",
    };
  } else {
    console.log(`[RAG] No OPENAI_API_KEY found, using Ollama ${OLLAMA_EMBEDDING_MODEL} for embeddings`);
    console.log("[RAG] Make sure Ollama is running: ollama serve");
    console.log(`[RAG] And the model is pulled: ollama pull ${OLLAMA_EMBEDDING_MODEL}`);
    return {
      model: createOllamaEmbeddingModel(OLLAMA_EMBEDDING_MODEL),
      dimension: getOllamaEmbeddingDimension(OLLAMA_EMBEDDING_MODEL),
      provider: "ollama",
    };
  }
}

const embeddingConfig = getEmbeddingConfig();

/**
 * Initialize RAG with the selected embedding model.
 * 
 * Note: We use `as any` because @convex-dev/rag bundles ai@5 (v2 models)
 * while the project uses ai@6 (v3 models). Our custom Ollama wrapper
 * implements the v2 spec directly.
 */
export const rag = new RAG<FilterTypes, Metadata>(components.rag, {
  textEmbeddingModel: embeddingConfig.model as any,
  embeddingDimension: embeddingConfig.dimension,
  filterNames: ["analysisId", "documentId", "contentType"],
});

/**
 * Export the embedding provider for debugging/logging
 */
export const embeddingProvider = embeddingConfig.provider;

/**
 * Build a namespace for an analysis.
 * Each analysis has its own isolated vector space.
 */
export function getAnalysisNamespace(analysisId: string): string {
  return `analysis:${analysisId}`;
}

/**
 * Build a unique key for a document's content in RAG.
 */
export function getDocumentKey(documentId: string, contentType: string): string {
  return `doc:${documentId}:${contentType}`;
}

/**
 * Chunk text into smaller pieces for better retrieval.
 * Uses a sliding window approach with overlap for context preservation.
 */
export function chunkText(
  text: string,
  options: {
    maxChunkSize?: number;
    overlap?: number;
    minChunkSize?: number;
  } = {}
): string[] {
  const {
    maxChunkSize = 1500, // ~375 tokens at 4 chars/token
    overlap = 200,
    minChunkSize = 100,
  } = options;

  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChunkSize;

    // Try to break at a sentence boundary
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf(".", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);

      if (breakPoint > start + minChunkSize) {
        end = breakPoint + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length >= minChunkSize) {
      chunks.push(chunk);
    }

    // Move start forward, accounting for overlap
    start = end - overlap;
    if (start <= (chunks.length > 0 ? end - maxChunkSize + overlap : 0)) {
      start = end; // Prevent infinite loop
    }
  }

  return chunks;
}

/**
 * Prepare document content for RAG indexing.
 * Combines title, abstract, and full text into a structured format.
 */
export function prepareDocumentContent(doc: {
  title: string;
  abstract?: string;
  fullText?: string;
  authors?: string[];
  year?: number;
}): string {
  const parts: string[] = [];

  // Title and metadata
  parts.push(`Title: ${doc.title}`);
  if (doc.authors?.length) {
    parts.push(`Authors: ${doc.authors.join(", ")}`);
  }
  if (doc.year) {
    parts.push(`Year: ${doc.year}`);
  }

  // Abstract
  if (doc.abstract) {
    parts.push(`\nAbstract:\n${doc.abstract}`);
  }

  // Full text
  if (doc.fullText) {
    parts.push(`\nFull Text:\n${doc.fullText}`);
  }

  return parts.join("\n");
}
