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
 * Phase 92 additions:
 *   - Levenshtein superRefine (85% threshold) verifies evidence quotes
 *   - Critic pass confirms quote fidelity (supported/unsupported/partial)
 *   - insufficient_evidence as first-class answer state
 *   - criticVerdict tracking for audit trail
 *
 * This is a pure async module -- NOT a Convex function file.
 * No "use node" directive, no function registrations.
 * Imported by the "use node" workpool action file.
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import { distance } from "fastest-levenshtein";
import { buildExtractionPrompts, buildCriticPrompt } from "../../lib/ai/core/prompts";
import { emitStageLog, emitStageError, computeCostUsd } from "./logging";
import type { Id } from "../_generated/dataModel";

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
  criticVerdict?: string;
}

// ---------------------------------------------------------------------------
// Zod extraction output schema factory (D-02, D-03, EXTR-03)
// ---------------------------------------------------------------------------

function buildExtractionSchema(bodyText: string) {
  return z
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
    .superRefine((data, ctx) => {
      // Early-return if bodyText is empty (nothing to validate against)
      if (!bodyText) return;

      // Defensive: out-of-bounds char offsets
      if (data.evidence_start_char < 0 || data.evidence_end_char > bodyText.length) {
        ctx.addIssue({
          code: "custom",
          message: `Evidence char offsets out of bounds: start=${data.evidence_start_char}, end=${data.evidence_end_char}, bodyText.length=${bodyText.length}`,
        });
        return;
      }

      // Defensive: start >= end
      if (data.evidence_start_char >= data.evidence_end_char) {
        ctx.addIssue({
          code: "custom",
          message: `Evidence start_char (${data.evidence_start_char}) must be less than end_char (${data.evidence_end_char})`,
        });
        return;
      }

      // Compute Levenshtein similarity (D-01)
      const sourceSlice = bodyText.slice(data.evidence_start_char, data.evidence_end_char);
      const maxLen = Math.max(data.evidence_quote.length, sourceSlice.length);
      const similarity = maxLen === 0 ? 1 : 1 - distance(data.evidence_quote, sourceSlice) / maxLen;

      if (similarity < 0.85) {
        ctx.addIssue({
          code: "custom",
          message: `Evidence quote failed Levenshtein verification: ${(similarity * 100).toFixed(1)}% similarity (threshold: 85%). Quote: "${data.evidence_quote.slice(0, 80)}..." vs source: "${sourceSlice.slice(0, 80)}..."`,
        });
      }
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
}

// ---------------------------------------------------------------------------
// Critic output schema (D-06, EXTR-05)
// ---------------------------------------------------------------------------

const criticOutputSchema = z.object({
  verdict: z.enum(["supported", "unsupported", "partial"]).describe(
    "Whether the evidence quote appears verbatim in the source and supports the answer"
  ),
  reason: z.string().describe("Brief explanation of the verdict"),
});

// ---------------------------------------------------------------------------
// Helpers (D-07, D-11, D-12)
// ---------------------------------------------------------------------------

function downgradeConfidence(current: "high" | "medium" | "low"): "high" | "medium" | "low" {
  if (current === "high") return "medium";
  if (current === "medium") return "low";
  return "low";
}

function makeInsufficientEvidence(
  questionId: string,
  modelUsed: string,
  reason: string,
  criticVerdict?: string,
  tokensIn?: number,
  tokensOut?: number
): ExtractionResult {
  return {
    questionId,
    answer: "insufficient_evidence",
    confidence: "low",
    reasoning: reason,
    modelUsed,
    criticVerdict,
    tokensIn: tokensIn ?? 0,
    tokensOut: tokensOut ?? 0,
  };
}

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
// Single-question extraction with cascade + Levenshtein + critic (D-04, D-18)
// ---------------------------------------------------------------------------

async function extractSingleAnswer(
  bodyText: string,
  question: QuestionInput,
  signal: AbortSignal,
  traceId?: string,
  jobId?: Id<"extractionJobs">,
  paperId?: Id<"extractionPapers">
): Promise<ExtractionResult> {
  const tiers = createCascadeTiers();
  const schema = buildExtractionSchema(bodyText);

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];

    // Two attempts per tier: attempt 0 = first try, attempt 1 = retry (D-04)
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompts = buildExtractionPrompts(
        { bodyText, question: question.question, expectedType: question.expectedType },
        attempt
      );

      try {
        const { output, usage } = await generateText({
          model: tier.model,
          output: Output.object({ schema }),
          temperature: 0,
          system: prompts.system,
          prompt: prompts.prompt,
          abortSignal: signal,
        });

        if (!output) {
          throw new Error(`Tier ${tier.name} returned null output`);
        }

        // --- CRITIC PASS (D-05, D-09) ---
        const sourceSlice = bodyText
          ? bodyText.slice(output.evidence_start_char, output.evidence_end_char)
          : "";

        const criticPrompts = buildCriticPrompt({
          question: question.question,
          answer: output.answer,
          evidenceQuote: output.evidence_quote,
          sourceSlice,
        });

        const criticStartMs = Date.now();
        try {
          const criticSignal = AbortSignal.timeout(30_000);
          const { output: criticOutput, usage: criticUsage } = await generateText({
            model: tier.model,
            output: Output.object({ schema: criticOutputSchema }),
            temperature: 0,
            system: criticPrompts.system,
            prompt: criticPrompts.prompt,
            abortSignal: criticSignal,
          });

          const criticLatencyMs = Date.now() - criticStartMs;
          const criticTokensIn = criticUsage.inputTokens ?? 0;
          const criticTokensOut = criticUsage.outputTokens ?? 0;
          if (traceId && jobId && paperId) {
            emitStageLog({
              traceId,
              jobId,
              paperId,
              stage: "critic",
              model: tier.name,
              tokensIn: criticTokensIn,
              tokensOut: criticTokensOut,
              costUsd: computeCostUsd(tier.name, criticTokensIn, criticTokensOut),
              latencyMs: criticLatencyMs,
              status: "success",
            });
          }

          // Aggregate tokens (D-20)
          const totalTokensIn = (usage.inputTokens ?? 0) + (criticUsage.inputTokens ?? 0);
          const totalTokensOut = (usage.outputTokens ?? 0) + (criticUsage.outputTokens ?? 0);

          if (criticOutput && criticOutput.verdict === "unsupported") {
            // Flip to insufficient_evidence (D-07)
            return makeInsufficientEvidence(
              question.key,
              tier.name,
              `Critic returned unsupported: ${criticOutput.reason}`,
              "unsupported",
              totalTokensIn,
              totalTokensOut
            );
          }

          if (criticOutput && criticOutput.verdict === "partial") {
            // Downgrade confidence (D-07)
            return {
              questionId: question.key,
              answer: output.answer,
              confidence: downgradeConfidence(output.confidence),
              evidenceQuote: output.evidence_quote,
              evidenceSourceId: output.evidence_source_id,
              evidenceStartChar: output.evidence_start_char,
              evidenceEndChar: output.evidence_end_char,
              reasoning: output.reasoning,
              modelUsed: tier.name,
              criticVerdict: "partial",
              tokensIn: totalTokensIn,
              tokensOut: totalTokensOut,
            };
          }

          // Supported (or null critic output treated as supported)
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
            criticVerdict: "supported",
            tokensIn: totalTokensIn,
            tokensOut: totalTokensOut,
          };
        } catch {
          // Critic timeout/failure: lenient -- keep the answer (D-09)
          if (traceId && jobId && paperId) {
            emitStageError({
              traceId,
              jobId,
              paperId,
              stage: "critic",
              model: tier.name,
              tokensIn: 0,
              tokensOut: 0,
              costUsd: 0,
              latencyMs: Date.now() - criticStartMs,
              status: "failure",
              errorMessage: "Critic timeout or failure",
              errorCategory: "timeout",
              retryable: false,
            });
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
            criticVerdict: "timeout",
            tokensIn: usage.inputTokens ?? 0,
            tokensOut: usage.outputTokens ?? 0,
          };
        }
      } catch (error) {
        // Extraction failed (schema validation, provider error, etc.)
        const isLastTier = i === tiers.length - 1;
        const isLastAttempt = attempt === 1;

        if (isLastAttempt && isLastTier) {
          // All tiers exhausted -- return insufficient_evidence (D-11, EXTR-08)
          return makeInsufficientEvidence(
            question.key,
            tier.name,
            `All extraction tiers exhausted: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        if (isLastAttempt) {
          // Last attempt on this tier -- escalate to next tier
          console.warn(
            `[ExtractionCascade] Tier ${tier.name} exhausted retries for question "${question.key}": ${error instanceof Error ? error.message : String(error)}`
          );
          break; // Break out of attempt loop, continue tier loop
        }

        // First attempt failed -- retry on same tier (D-04)
        console.warn(
          `[ExtractionCascade] Tier ${tier.name} attempt ${attempt + 1} failed for question "${question.key}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // Unreachable, but TypeScript needs it
  return makeInsufficientEvidence(
    question.key,
    "unknown",
    "Cascade exhausted unexpectedly"
  );
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
  _parsingSource?: string,
  traceId?: string,
  jobId?: Id<"extractionJobs">,
  paperId?: Id<"extractionPapers">
): Promise<ExtractionResult[]> {
  const CONCURRENCY_CAP = 5;
  const PER_QUESTION_TIMEOUT_MS = 60_000;

  const tasks = questions.map(
    (question) => () => {
      const signal = AbortSignal.timeout(PER_QUESTION_TIMEOUT_MS);
      return extractSingleAnswer(bodyText, question, signal, traceId, jobId, paperId);
    }
  );

  const settled = await withConcurrencyLimit(tasks, CONCURRENCY_CAP);

  return settled.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    // withConcurrencyLimit should not reject for extractSingleAnswer
    // (it catches internally), but handle defensively
    return makeInsufficientEvidence(
      questions[i].key,
      "unknown",
      `Unexpected rejection: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
    );
  });
}
