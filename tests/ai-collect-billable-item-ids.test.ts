import { describe, expect, it } from "vitest";

import {
  collectBillableItemIds,
  type BillableEntry,
  type Pricing,
} from "@/convex/ai/lib/collectBillableItemIds";
import type { Usage } from "@/lib/ai/core";

const PRICING: Pricing = { input: 1, output: 2 };

function entry(itemId: string | undefined, usage: Usage): BillableEntry {
  return { itemId, usage };
}

function usage(input: number, output: number): Usage {
  return {
    promptTokens: input,
    completionTokens: output,
    inputTokens: input,
    outputTokens: output,
  };
}

describe("collectBillableItemIds", () => {
  it("returns ids in input order for entries that would deduct positive credits", () => {
    const entries: BillableEntry[] = [
      entry("paper-a", usage(1_000_000, 500_000)),
      entry("paper-b", usage(500_000, 250_000)),
      entry("paper-c", usage(2_000_000, 1_000_000)),
    ];

    const ids = collectBillableItemIds(entries, PRICING);
    expect(ids).toEqual(["paper-a", "paper-b", "paper-c"]);
  });

  it("skips entries whose usage would round to zero credits", () => {
    const entries: BillableEntry[] = [
      entry("paper-a", usage(1_000_000, 500_000)),
      entry("paper-zero-tokens", usage(0, 0)),
      entry("paper-c", usage(500_000, 250_000)),
    ];

    const ids = collectBillableItemIds(entries, PRICING);
    expect(ids).toEqual(["paper-a", "paper-c"]);
    expect(ids).not.toContain("paper-zero-tokens");
  });

  it("skips entries with no itemId — does not fall back to metadata", () => {
    const entries: BillableEntry[] = [
      // explicit-undefined itemId entry that WOULD bill positive credits
      // — must still be skipped, because the salvage path cannot map it
      // back to a result key without a typed identifier
      { usage: usage(1_000_000, 500_000) } as BillableEntry,
      entry("paper-keeps-id", usage(500_000, 250_000)),
    ];

    const ids = collectBillableItemIds(entries, PRICING);
    expect(ids).toEqual(["paper-keeps-id"]);
  });

  it("returns an empty array when no entries are billable", () => {
    const entries: BillableEntry[] = [
      entry("paper-zero-1", usage(0, 0)),
      entry("paper-zero-2", usage(0, 0)),
    ];

    expect(collectBillableItemIds(entries, PRICING)).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(collectBillableItemIds([], PRICING)).toEqual([]);
  });
});
