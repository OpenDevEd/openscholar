"use node";

/**
 * Enhanced extraction prompts for academic paper analysis
 * Strong instructions to ensure AI thoroughly searches provided content
 */

import type { ChunkMetadata } from "./chunking";

export interface ExtractionQuestion {
  key: string;
  question: string;
  type: string;
  description?: string;
}

export interface ChunkWithContext {
  text: string;
  metadata: ChunkMetadata;
  relevanceScore?: number;
}

/**
 * Build enhanced extraction prompt with strong search instructions
 */
export function buildEnhancedExtractionPrompt(
  question: ExtractionQuestion,
  abstract: string | undefined,
  chunks: ChunkWithContext[]
): string {
  let prompt = `You are an expert research assistant extracting specific data from academic papers.

`;

  // Add abstract if available
  if (abstract) {
    prompt += `ABSTRACT (for context):
${abstract}

`;
  }

  // Add PDF content with clear formatting
  if (chunks.length > 0) {
    prompt += `SOURCE MATERIAL FROM THE FULL PAPER - READ ALL PASSAGES CAREFULLY:
`;
    prompt += `The following passages are extracted from the paper. You MUST search through ALL of them to find the answer. The information you need IS in these passages.

`;

    chunks.forEach((chunk, index) => {
      const { page, charRange } = chunk.metadata;
      const [start, end] = charRange;
      const relevance = chunk.relevanceScore
        ? ` (relevance: ${(chunk.relevanceScore * 100).toFixed(0)}%)`
        : "";

      prompt += `[${index + 1}] Page ${page}, characters ${start}-${end}${relevance}:
${chunk.text}\n\n`;
    });
  }

  // Question section
  prompt += `EXTRACTION TASK:
Question: ${question.question}
`;

  if (question.description) {
    prompt += `Additional Context: ${question.description}\n`;
  }

  prompt += `Expected Answer Type: ${question.type}

`;

  // Strong instructions
  prompt += `INSTRUCTIONS - FOLLOW EXACTLY:
1. You MUST search through ALL provided passages above. The answer is contained in the source material.
2. Read each passage carefully and identify specific facts, numbers, dates, and statements.
3. If the answer requires information from multiple passages, combine them accurately.
4. Answer ONLY based on the source material provided above. Do not use outside knowledge.
5. If you cannot find the answer after searching ALL passages, respond with null.
6. Be specific and cite page numbers when possible (e.g., "Found on page 3").
7. For factual questions (sample sizes, dates, measurements): Look for exact numbers and units.
8. For interpretive questions (methods, conclusions): Look for explicit statements in the text.
9. Provide a confidence score (0.0-1.0) where 1.0 = definitely found in text, 0.0 = not found.
10. Include brief reasoning explaining where in the text you found the answer.

Respond in the requested JSON format. Do not say "content is empty" or "no information provided" - the information IS in the passages above.\n`;

  return prompt;
}

/**
 * Build prompt for LLM-based reranking
 */
export function buildRerankingPrompt(
  question: string,
  chunkText: string,
  chunkMetadata: ChunkMetadata
): string {
  const { page, charRange } = chunkMetadata;
  const [start, end] = charRange;

  return `Rate how relevant this passage is for answering the question.

Question: ${question}

Passage [Page ${page}, chars ${start}-${end}]:
${chunkText.substring(0, 1500)}${chunkText.length > 1500 ? "..." : ""}

Rate from 0.0 to 1.0 where:
- 1.0 = Contains direct answer to the question
- 0.7-0.9 = Highly relevant, contains related information
- 0.4-0.6 = Somewhat relevant, tangential information
- 0.1-0.3 = Minimally relevant
- 0.0 = Not relevant at all

Return ONLY a number between 0.0 and 1.0.`;
}

/**
 * Build prompt for query expansion (academic terminology)
 */
export function buildQueryExpansionPrompt(
  originalQuestion: string
): string {
  return `Expand this research extraction question with academic terminology and synonyms.

Original Question: ${originalQuestion}

Provide 3 search queries:
1. Original question (exactly as written)
2. Keyword-focused version (extract key terms, numbers, technical terms)
3. Academic-expanded version (expand acronyms, add synonyms, use formal academic language)

Format your response as:
QUERY_1: [original]
QUERY_2: [keywords]
QUERY_3: [academic expanded]

Queries should be optimized for semantic search in academic papers.`;
}

/**
 * Detect if question is factual or interpretive
 */
export function detectQuestionType(question: string): "factual" | "interpretive" {
  const factualPatterns = [
    /\b(\d+|what|how many|how much|when|where|who|which)\b/i,
    /\b(sample size|n=|number of|count|percentage|rate|ratio|p-value)\b/i,
    /\b(date|year|month|day|time|duration|period)\b/i,
    /\b(measure|measurement|value|amount|quantity|size)\b/i,
  ];

  const interpretivePatterns = [
    /\b(why|explain|describe|discuss|analyze|evaluate|interpret)\b/i,
    /\b(method|approach|strategy|technique|design|framework)\b/i,
    /\b(conclusion|finding|result|implication|significance|meaning)\b/i,
    /\b(compare|contrast|difference|similarity|relationship)\b/i,
  ];

  const factualScore = factualPatterns.filter((p) => p.test(question)).length;
  const interpretiveScore = interpretivePatterns.filter((p) =>
    p.test(question)
  ).length;

  return factualScore >= interpretiveScore ? "factual" : "interpretive";
}

/**
 * Build schema for extraction answer
 */
export function getExtractionSchema(): object {
  return {
    type: "object",
    properties: {
      answer: {
        oneOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "array", items: { type: "string" } },
          { type: "null" },
        ],
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Confidence that answer was found in text (1.0 = definitely found)",
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of where answer was found",
      },
      sourceLocation: {
        type: "string",
        description: "Page numbers where answer was found",
      },
    },
    required: ["answer", "confidence", "reasoning"],
  };
}
