/**
 * Pure helper — extract the input batch item identifiers for entries
 * whose `usage` would yield a positive credit deduction. Used by the
 * mid-batch credit-exhaustion salvage path in `withAuthAndCreditsBatch`
 * to feed `applyUnpaidBatchItemErrors`.
 *
 * Reads `entry.itemId` (the typed input identifier — keys back into
 * `BatchResult.results` and `BatchResult.errors[].paperId`). Does NOT
 * read `entry.metadata?.openalexId` or `entry.metadata?.paperId` —
 * typed first-class fields only, per the doctrine at
 * `convex/ai/helpers.ts:139-146,1668-1670` and the slice-03 plan
 * deviation note.
 *
 * Lives in its own file (not directly in helpers.ts) so test files
 * running outside the Node-runtime test environment can import it
 * without dragging in the action surface area. Re-exported by
 * helpers.ts so call sites keep their existing import path.
 */

import type { Usage } from "../../../lib/ai/core";
import { calculateCreditsToDeductFromUsage } from "./creditBilling";
import { AI_COST_MARKUP } from "../../lib/constants";

export type Pricing = { input: number; output: number };

/**
 * Minimal shape consumed by `collectBillableItemIds`. Kept structural
 * (not a re-export of `UsageBreakdownEntry`) so this module stays
 * dependency-free of the wider helpers surface.
 */
export type BillableEntry = {
  usage: Usage;
  itemId?: string;
};

export function collectBillableItemIds(
  entries: ReadonlyArray<BillableEntry>,
  pricing: Pricing,
): string[] {
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.itemId) continue;
    const credits = calculateCreditsToDeductFromUsage({
      usage: entry.usage,
      pricing,
      markupMultiplier: AI_COST_MARKUP,
    });
    if (credits > 0) {
      ids.push(entry.itemId);
    }
  }
  return ids;
}
