/**
 * Per-item credit deduction with mid-batch salvage.
 *
 * Walks `usageBreakdown` and deducts credits for each entry whose
 * computed amount is positive. On the first
 * `INSUFFICIENT_CREDITS`-classified failure, switches to the salvage
 * path:
 *
 *   1. The items 0..index-1 are paid — keep their entries in
 *      `result.results` untouched.
 *   2. From `index` onward, build the unpaid id list with
 *      `collectBillableItemIds` (typed `entry.itemId`, no metadata
 *      reads).
 *   3. Emit `credits_exhausted_mid_batch` telemetry with the unpaid
 *      count and the first unpaid id.
 *   4. Return `applyUnpaidBatchItemErrors(result, unpaidItemIds)` —
 *      drops the unpaid keys from `results` and appends structured
 *      errors keyed by `paperId`.
 *
 * Lives in its own module (no `"use node"` directive, no Convex
 * server bindings) so pure-logic tests can mock the deduction
 * callback and exercise the full salvage flow without bringing in
 * the Node-runtime action surface.
 *
 * Non-INSUFFICIENT_CREDITS errors rethrow unchanged. If the salvage
 * cannot identify a single unpaid id (every entry missing `itemId`
 * — shouldn't happen for properly-instrumented batch flows but
 * defended against), rethrow so the caller sees the original
 * INSUFFICIENT_CREDITS.
 */

import { applyUnpaidBatchItemErrors } from "../../../lib/ai/core/batch-partial";
import { classifyUnknownError } from "../../../lib/errors/taxonomy";
import type { BatchError } from "../../../lib/ai/core/batch-types";
import { collectBillableItemIds } from "./collectBillableItemIds";
import { calculateCreditsToDeductFromUsage } from "./creditBilling";
import { AI_COST_MARKUP } from "../../lib/constants";
import type { Usage } from "../../../lib/ai/core";
import type { Id } from "../../_generated/dataModel";

export type Pricing = { input: number; output: number };

export type DeductBreakdownEntry = {
  usage: Usage;
  itemId?: string;
  description?: string;
  metadata?: Record<string, string>;
  // Re-exposed only for the deduction callback's payload.
  billingType?:
    | "extraction_llm"
    | "embedding"
    | "screening"
    | "chat"
    | "search"
    | "translation"
    | "wallet_api";
  jobId?: Id<"extractionJobs">;
  paperId?: Id<"extractionPapers">;
  resultId?: Id<"extractionResults">;
};

export type BatchShapedResult = {
  results: Record<string, unknown>;
  errors: BatchError[];
};

export type DeductCreditsCallback = (args: {
  amount: number;
  description?: string;
  metadata?: Record<string, string>;
  billingType?: DeductBreakdownEntry["billingType"];
  jobId?: Id<"extractionJobs">;
  paperId?: Id<"extractionPapers">;
  resultId?: Id<"extractionResults">;
}) => Promise<unknown>;

export type CaptureServerEventCallback = (
  distinctId: string,
  event: string,
  properties: Record<string, unknown>,
) => Promise<void>;

export async function applyBatchItemDeductions<T extends BatchShapedResult>(args: {
  result: T;
  usageBreakdown: ReadonlyArray<DeductBreakdownEntry>;
  pricing: Pricing;
  clerkId: string;
  operation: string;
  availableCreditsAtStart: number;
  deductCredits: DeductCreditsCallback;
  captureServerEvent: CaptureServerEventCallback;
}): Promise<T> {
  const {
    result,
    usageBreakdown,
    pricing,
    clerkId,
    operation,
    availableCreditsAtStart,
    deductCredits,
    captureServerEvent,
  } = args;

  for (let index = 0; index < usageBreakdown.length; index++) {
    const entry = usageBreakdown[index];
    const amount = calculateCreditsToDeductFromUsage({
      usage: entry.usage,
      pricing,
      markupMultiplier: AI_COST_MARKUP,
    });
    if (amount <= 0) continue;
    try {
      await deductCredits({
        amount,
        description: entry.description,
        metadata: entry.metadata,
        billingType: entry.billingType,
        jobId: entry.jobId,
        paperId: entry.paperId,
        resultId: entry.resultId,
      });
    } catch (error) {
      const classified = classifyUnknownError(error);
      if (classified.code !== "insufficient_credits") throw error;
      const remainingEntries = usageBreakdown.slice(index);
      const unpaidItemIds = collectBillableItemIds(remainingEntries, pricing);
      if (unpaidItemIds.length === 0) throw error;
      await captureServerEvent(clerkId, "credits_exhausted_mid_batch", {
        feature: operation,
        unpaid_item_count: unpaidItemIds.length,
        first_unpaid_item_id: unpaidItemIds[0],
        available_credits: availableCreditsAtStart,
      });
      return applyUnpaidBatchItemErrors(result, unpaidItemIds);
    }
  }
  return result;
}
