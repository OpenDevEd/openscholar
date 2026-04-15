/**
 * Three-tier extraction cascade for academic paper question answering.
 *
 * Exported function: extractAnswers(bodyText, questions, parsingSource)
 *   -> ExtractionResult[]
 *
 * Cascade order (cheapest first):
 *   1. Gemini 2.5 Flash Lite (pre-screen)
 *   2. Gemini 3 Flash Preview (default)
 *   3. Claude Haiku 4.5 (escalation)
 *
 * Escalation is failure-driven (schema error or provider error),
 * NOT confidence-based. Each tier uses Output.object with Zod schema.
 *
 * This is a pure async module -- NOT a Convex function file.
 * No "use node" directive, no function registrations.
 * Imported by the "use node" workpool action file.
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { buildExtractionPrompts } from "../../lib/ai/core/prompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuestionInput {
  key: string;
  question: string;
  expectedType?: string;
}

export interface ExtractionResult {
  questionId: string;
  answer: string | null;
  confidence?: "high" | "medium" | "low";
  evidenceQuote?: string;
  evidenceSourceId?: string;
  evidenceStartChar?: number;
  evidenceEndChar?: number;
  reasoning?: string;
  modelUsed?: string;
  tokensIn?: number;
  tokensOut?: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Zod extraction output schema (D-12, EXTR-02)
// ---------------------------------------------------------------------------

const extractionOutputSchema = z
  .object({
    reasoning: z.string().describe(
      "Step-by-step reasoning referencing specific text from the paper. Explain WHY this answer is correct."
    ),
    answer: z.string().describe(
      "The extracted answer to the question. Use the exact text from the paper when possible."
    ),
    confidence: z.enum(["high", "medium", "low"]).describe(
      "Confidence level: high = explicit statement, medium = inferred, low = uncertain/partial evidence"
    ),
    evidence_quote: z.string().describe(
      "Verbatim quote from the source text that supports this answer. Must be an exact substring."
    ),
    evidence_source_id: z.string().describe(
      "Section or paragraph identifier where the evidence was found"
    ),
    evidence_start_char: z.number().describe(
      "Start character offset of the evidence quote in the full source text"
    ),
    evidence_end_char: z.number().describe(
      "End character offset of the evidence quote in the full source text"
    ),
  })
  .meta({
    propertyOrdering: [
      "reasoning",
      "answer",
      "confidence",
      "evidence_quote",
      "evidence_source_id",
      "evidence_start_char",
      "evidence_end_char",
    ],
  });

// ---------------------------------------------------------------------------
// Cascade tier definitions (D-04, D-05, D-08)
// ---------------------------------------------------------------------------

interface CascadeTier {
  model: LanguageModel;
  name: string;
}

function createCascadeTiers(): CascadeTier[] {
  const openrouter = createOpenRouter();

  return [
    {
      name: "google/gemini-2.5-flash-lite",
      model: openrouter("google/gemini-2.5-flash-lite", {
        plugins: [{ id: "response-healing" }],
        provider: { allowFallbacks: true },
      }),
    },
    {
      name: "google/gemini-3-flash-preview",
      model: openrouter("google/gemini-3-flash-preview", {
        plugins: [{ id: "response-healing" }],
        provider: { allowFallbacks: true },
      }),
    },
    {
      name: "anthropic/claude-haiku-4.5",
      model: openrouter("anthropic/claude-haiku-4.5", {
        plugins: [{ id: "response-healing" }],
        provider: { allowFallbacks: true },
      }),
    },
  ];
}

// ---------------------------------------------------------------------------
// Single-question extraction with cascade (D-04, D-06, D-14)
// ---------------------------------------------------------------------------

async function extractSingleAnswer(
  bodyText: string,
  question: QuestionInput,
  signal: AbortSignal
): Promise<ExtractionResult> {
  const tiers = createCascadeTiers();
  const prompts = buildExtractionPrompts(
    { bodyText, question: question.question, expectedType: question.expectedType },
    0
  );

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    try {
      const { output, usage } = await generateText({
        model: tier.model,
        output: Output.object({ schema: extractionOutputSchema }),
        temperature: 0,
        system: prompts.system,
        prompt: prompts.prompt,
        abortSignal: signal,
      });

      if (!output) {
        throw new Error(`Tier ${tier.name} returned null output`);
      }

      return {
        questionId: question.key,
        answer: output.answer,
        confidence: output.confidence,
        evidenceQuote: output.evidence_quote,
        evidenceSourceId: output.evidence_source_id,
        evidenceStartChar: output.evidence_start_char,
        evidenceEndChar: output.evidence_end_char,
        reasoning: output.reasoning,
        modelUsed: tier.name,
        tokensIn: usage.inputTokens ?? 0,
        tokensOut: usage.outputTokens ?? 0,
      };
    } catch (error) {
      const isLastTier = i === tiers.length - 1;
      if (isLastTier) {
        // All tiers exhausted -- return failed result
        return {
          questionId: question.key,
          answer: null,
          modelUsed: tier.name,
          errorMessage: `All cascade tiers failed. Last error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      // Log and escalate to next tier
      console.warn(
        `[ExtractionCascade] Tier ${tier.name} failed for question "${question.key}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Unreachable, but TypeScript needs it
  return {
    questionId: question.key,
    answer: null,
    errorMessage: "Cascade exhausted unexpectedly",
  };
}

// ---------------------------------------------------------------------------
// Inline concurrency limiter (D-13, EXTR-10)
// ---------------------------------------------------------------------------

async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let running = 0;
  let index = 0;

  return new Promise((resolve) => {
    function next() {
      while (running < limit && index < tasks.length) {
        const i = index++;
        running++;
        tasks[i]()
          .then((value) => {
            results[i] = { status: "fulfilled", value };
          })
          .catch((reason) => {
            results[i] = { status: "rejected", reason };
          })
          .finally(() => {
            running--;
            if (index >= tasks.length && running === 0) {
              resolve(results);
            } else {
              next();
            }
          });
      }
    }
    if (tasks.length === 0) {
      resolve([]);
    } else {
      next();
    }
  });
}

// ---------------------------------------------------------------------------
// Main export function (D-20, EXTR-10)
// ---------------------------------------------------------------------------

export async function extractAnswers(
  bodyText: string,
  questions: QuestionInput[],
  _parsingSource?: string
): Promise<ExtractionResult[]> {
  const CONCURRENCY_CAP = 5;
  const PER_QUESTION_TIMEOUT_MS = 60_000;

  const tasks = questions.map(
    (question) => () => {
      const signal = AbortSignal.timeout(PER_QUESTION_TIMEOUT_MS);
      return extractSingleAnswer(bodyText, question, signal);
    }
  );

  const settled = await withConcurrencyLimit(tasks, CONCURRENCY_CAP);

  return settled.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    // withConcurrencyLimit should not reject for extractSingleAnswer
    // (it catches internally), but handle defensively
    return {
      questionId: questions[i].key,
      answer: null,
      errorMessage: `Unexpected rejection: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    };
  });
}
