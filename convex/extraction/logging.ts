/**
 * Structured logging for the extraction pipeline.
 *
 * Pure function module -- no Convex imports beyond Id type.
 * Emits structured JSON via console.info/console.error for grep-friendly
 * incident triage. No ad-hoc console.log strings in the extraction pipeline.
 *
 * Consumed by workpoolActions.ts and extract.ts.
 */

import type { Id } from "../_generated/dataModel";
import type { ErrorCategory } from "./errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtractionStage = "parse" | "extract" | "critic" | "save";

export interface StageLogParams {
  traceId: string;
  jobId: Id<"extractionJobs">;
  paperId: Id<"extractionPapers">;
  stage: ExtractionStage;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  status: "success" | "failure" | "skip";
}

export interface StageErrorParams extends StageLogParams {
  errorMessage: string;
  errorCategory: ErrorCategory;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Cost map (OpenRouter pricing, verified 2026-04-15)
// ---------------------------------------------------------------------------

export const COST_PER_MILLION_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  "google/gemini-2.5-flash-lite": { input: 0.10, output: 0.40 },
  "google/gemini-3-flash-preview": { input: 0.50, output: 3.00 },
  "anthropic/claude-haiku-4.5": { input: 1.00, output: 5.00 },
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Compute estimated cost in USD for a model invocation.
 *
 * Returns 0 for unknown models (safe fallback -- cost is approximate
 * for display only, not used for billing).
 */
export function computeCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const pricing = COST_PER_MILLION_TOKENS[model];
  if (!pricing) return 0;
  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}

/**
 * Emit a structured stage log via console.info.
 *
 * Single JSON line per invocation -- grep-friendly for incident triage.
 */
export function emitStageLog(params: StageLogParams): void {
  console.info(JSON.stringify(params));
}

/**
 * Emit a structured stage error log via console.error.
 *
 * Single JSON line per invocation with error details appended to the
 * base 10 fields (errorMessage, errorCategory, retryable).
 */
export function emitStageError(params: StageErrorParams): void {
  console.error(JSON.stringify(params));
}
