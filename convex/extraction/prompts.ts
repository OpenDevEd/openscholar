"use node";

/**
 * Enhanced extraction prompts for academic paper analysis
 * Strong instructions to ensure AI thoroughly searches provided content
 */

export interface ExtractionQuestion {
  key: string;
  question: string;
  type: string;
  description?: string;
}

export interface EvidenceWithContext {
  evidenceId: string;
  text: string;
  page: number;
  charRange: [number, number];
  section?: string;
  relevanceScore?: number;
}

/**
 * Build enhanced extraction prompt with strong search instructions
 */
export function buildEnhancedExtractionPrompt(
  question: ExtractionQuestion,
  abstract: string | undefined,
  evidence: EvidenceWithContext[]
): string {
  const hasEvidence = evidence.length > 0;
  let prompt = `You are an expert research assistant extracting structured answers from academic papers.

`;

  // Add abstract if available
  if (abstract) {
    prompt += `ABSTRACT (for context):
${abstract}

`;
  }

  // Add PDF content with clear formatting
  if (hasEvidence) {
    prompt += `SOURCE EVIDENCE FROM THE FULL PAPER:
`;
    prompt += `Each evidence item has an EVIDENCE ID, page number, and character range. You MUST only cite evidence IDs present below.

`;

    evidence.forEach((item) => {
      const [start, end] = item.charRange;
      const relevance = item.relevanceScore
        ? ` (relevance: ${(item.relevanceScore * 100).toFixed(0)}%)`
        : "";
      const section = item.section ? ` section=${item.section}` : "";

      prompt += `[EVIDENCE ${item.evidenceId}] page=${item.page} chars=${start}-${end}${section}${relevance}
${item.text}\n\n`;
    });
  } else {
    prompt += `NO FULL-PAPER EVIDENCE IS AVAILABLE.
You are in ABSTRACT-ONLY mode. If the abstract supports the question, answer using only the abstract.
In ABSTRACT-ONLY mode you MUST return supportEvidenceIds as an empty array ([]).

`;
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

  if (question.type === "array") {
    prompt += `ARRAY ANSWER RULES:
- Return concise canonical items only (no narrative text).
- Prefer specific model/tool names over umbrella terms.
- Maximum 8 items in the final array.
- Do not duplicate synonymous variants in the same answer.

`;
  }

  // Strong instructions
  prompt += `INSTRUCTIONS - FOLLOW EXACTLY:
1. Use ONLY the provided evidence and abstract. Do not use outside knowledge.
2. ${hasEvidence ? "You may cite only evidence IDs listed above." : "In ABSTRACT-ONLY mode, supportEvidenceIds must always be []."}
3. ${hasEvidence ? "Do NOT invent IDs and do NOT quote text that is not in the evidence list." : "Do not invent evidence IDs."}
4. Prefer a best-effort answer when support is suggestive but incomplete.
5. If there is no support at all, set answer to null and supportEvidenceIds to [].
6. Confidence must be between 0.0 and 1.0.
7. Keep reasoning concise and evidence-based, and tie it to the abstract when in ABSTRACT-ONLY mode.

Return strict JSON:
{
  "answer": <value|null>,
  "confidence": <number>,
  "reasoning": <string>,
  "supportEvidenceIds": [<string>, ...]
}\n`;

  return prompt;
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
