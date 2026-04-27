import { describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";

import {
  applyBatchItemDeductions,
  type DeductBreakdownEntry,
  type Pricing,
} from "@/convex/ai/lib/applyBatchItemDeductions";
import {
  BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR,
} from "@/lib/ai/core/batch-partial";
import type { BatchScreeningResult } from "@/lib/ai/core/batch-types";
import type { Usage } from "@/lib/ai/core";

// Pricing tuned so each entry below yields exactly 30 credits via
// calculateCreditsToDeductFromUsage:
//   costDollars = (input * 100 + output * 100) / 1_000_000
//                = (1500 * 100 + 750 * 100) / 1_000_000
//                = 0.225
//   * markup 1.3 = 0.2925
//   * creditsPerUsd 10000 = 2925
// Hmm too high. Using simpler values: input 100, output 100 -> per-million prices 100.
// We want 30 credits. Let me use small priced values and small token counts.
// costDollars = (1000 * 1 + 500 * 2) / 1_000_000 = 0.002
//   * 1.3 = 0.0026
//   * 10000 = 26 -> ceil = 26.
// Try input 1200, output 600: (1200 + 1200) / 1_000_000 * 1.3 * 10000 = 31.2 -> ceil = 32.
// Try input 1000, output 600: (1000 + 1200) / 1_000_000 * 1.3 * 10000 = 28.6 -> ceil 29.
// Use input 1100, output 600 = (1100 + 1200) * 1.3 / 100 = 29.9 -> ceil 30. Perfect.
const PRICING: Pricing = { input: 1, output: 2 };

function usageFor30Credits(): Usage {
  // costDollars = (1100 * 1 + 600 * 2) / 1_000_000 = 0.0023
  // credits = ceil(0.0023 * 1.3 * 10000) = ceil(29.9) = 30
  return {
    promptTokens: 1100,
    completionTokens: 600,
    inputTokens: 1100,
    outputTokens: 600,
  };
}

function makeEntry(itemId: string): DeductBreakdownEntry {
  return {
    itemId,
    usage: usageFor30Credits(),
    billingType: "screening",
    metadata: { openalexId: itemId },
  };
}

function makeBatchResult(itemIds: string[]): BatchScreeningResult {
  const results: BatchScreeningResult["results"] = {};
  for (const id of itemIds) {
    results[id] = { responses: { q1: true }, confidence: 0.8 };
  }
  return { results, errors: [] };
}

function insufficientCreditsError(needed: number, have: number): ConvexError<{
  code: string;
  message: string;
}> {
  return new ConvexError({
    code: "INSUFFICIENT_CREDITS",
    message: `Insufficient credits: need ${needed}, have ${have}`,
  });
}

describe("applyBatchItemDeductions", () => {
  it("deducts credits for every item when balance is sufficient", async () => {
    const itemIds = ["paper-a", "paper-b", "paper-c"];
    const usageBreakdown = itemIds.map(makeEntry);
    const result = makeBatchResult(itemIds);

    const deductCredits = vi.fn().mockResolvedValue(undefined);
    const captureServerEvent = vi.fn().mockResolvedValue(undefined);

    const out = await applyBatchItemDeductions({
      result,
      usageBreakdown,
      pricing: PRICING,
      clerkId: "clerk_user",
      operation: "Batch screening (3 papers)",
      availableCreditsAtStart: 1000,
      deductCredits,
      captureServerEvent,
    });

    expect(deductCredits).toHaveBeenCalledTimes(3);
    expect(deductCredits).toHaveBeenNthCalledWith(1, expect.objectContaining({
      amount: 30,
      billingType: "screening",
      metadata: { openalexId: "paper-a" },
    }));
    expect(captureServerEvent).not.toHaveBeenCalled();
    expect(Object.keys(out.results)).toEqual(itemIds);
    expect(out.errors).toEqual([]);
  });

  it("salvages paid items, errors unpaid items, and emits credits_exhausted_mid_batch on mid-batch INSUFFICIENT_CREDITS", async () => {
    const itemIds = ["paper-a", "paper-b", "paper-c", "paper-d", "paper-e"];
    const usageBreakdown = itemIds.map(makeEntry);
    const result = makeBatchResult(itemIds);

    let calls = 0;
    const deductCredits = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls > 3) {
        throw insufficientCreditsError(30, 0);
      }
    });
    const captureServerEvent = vi.fn().mockResolvedValue(undefined);

    const out = await applyBatchItemDeductions({
      result,
      usageBreakdown,
      pricing: PRICING,
      clerkId: "clerk_partial",
      operation: "Batch screening (5 papers)",
      availableCreditsAtStart: 90,
      deductCredits,
      captureServerEvent,
    });

    // Exactly 4 deduct calls: first 3 succeeded, the 4th threw.
    expect(deductCredits).toHaveBeenCalledTimes(4);

    // Paid items kept; unpaid items moved to errors.
    expect(Object.keys(out.results).sort()).toEqual([
      "paper-a",
      "paper-b",
      "paper-c",
    ]);
    expect(out.errors).toEqual(
      expect.arrayContaining([
        { paperId: "paper-d", error: BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR },
        { paperId: "paper-e", error: BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR },
      ]),
    );
    expect(out.errors).toHaveLength(2);

    // Telemetry fired exactly once with the correct payload.
    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith(
      "clerk_partial",
      "credits_exhausted_mid_batch",
      expect.objectContaining({
        feature: "Batch screening (5 papers)",
        unpaid_item_count: 2,
        first_unpaid_item_id: "paper-d",
        available_credits: 90,
      }),
    );
  });

  it("rethrows non-INSUFFICIENT_CREDITS errors without salvaging", async () => {
    const itemIds = ["paper-a", "paper-b"];
    const usageBreakdown = itemIds.map(makeEntry);
    const result = makeBatchResult(itemIds);

    const deductCredits = vi.fn().mockImplementation(async () => {
      throw new Error("network: fetch failed");
    });
    const captureServerEvent = vi.fn().mockResolvedValue(undefined);

    await expect(
      applyBatchItemDeductions({
        result,
        usageBreakdown,
        pricing: PRICING,
        clerkId: "clerk_x",
        operation: "Batch screening (2 papers)",
        availableCreditsAtStart: 100,
        deductCredits,
        captureServerEvent,
      }),
    ).rejects.toThrow(/network: fetch failed/);

    expect(captureServerEvent).not.toHaveBeenCalled();
  });

  it("rethrows INSUFFICIENT_CREDITS when no remaining entry has an itemId (defensive)", async () => {
    // Two entries; only the second is missing itemId. First deduct succeeds;
    // second throws — but since the remaining slice has no itemIds, the
    // salvage cannot identify any unpaid item and rethrows instead of
    // silently salvaging zero items.
    const usageBreakdown: DeductBreakdownEntry[] = [
      makeEntry("paper-a"),
      { usage: usageFor30Credits(), billingType: "screening" },
    ];
    const result = makeBatchResult(["paper-a"]);

    let calls = 0;
    const deductCredits = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls > 1) throw insufficientCreditsError(30, 0);
    });
    const captureServerEvent = vi.fn().mockResolvedValue(undefined);

    await expect(
      applyBatchItemDeductions({
        result,
        usageBreakdown,
        pricing: PRICING,
        clerkId: "clerk_y",
        operation: "Batch screening (2 papers, partial typed)",
        availableCreditsAtStart: 30,
        deductCredits,
        captureServerEvent,
      }),
    ).rejects.toBeInstanceOf(ConvexError);

    expect(captureServerEvent).not.toHaveBeenCalled();
  });

  it("skips entries that compute to zero credits without calling the deduction callback for them", async () => {
    const usageBreakdown: DeductBreakdownEntry[] = [
      makeEntry("paper-a"),
      {
        itemId: "paper-zero-tokens",
        usage: { promptTokens: 0, completionTokens: 0, inputTokens: 0, outputTokens: 0 },
        billingType: "screening",
      },
      makeEntry("paper-c"),
    ];
    const result = makeBatchResult(["paper-a", "paper-zero-tokens", "paper-c"]);

    const deductCredits = vi.fn().mockResolvedValue(undefined);
    const captureServerEvent = vi.fn().mockResolvedValue(undefined);

    const out = await applyBatchItemDeductions({
      result,
      usageBreakdown,
      pricing: PRICING,
      clerkId: "clerk_zero",
      operation: "Batch screening (zero-token middle item)",
      availableCreditsAtStart: 1000,
      deductCredits,
      captureServerEvent,
    });

    // Only 2 deductions, not 3.
    expect(deductCredits).toHaveBeenCalledTimes(2);
    // Zero-token paper stays in results unchanged (no credit charged).
    expect(out.results).toHaveProperty("paper-zero-tokens");
  });
});
