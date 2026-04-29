import type { WebSearchPricing } from "@/lib/pricing";

export interface FormatSearchCostInput {
  /** Actual credits billed for this call, when known (output-available
   *  with usage). Wins over the estimate when present. */
  creditsUsed?: number;
  /** Estimate path data when no actual cost is known yet. `creditsPerCall`
   *  is `null` for the unsupported path; the caller decides whether to
   *  hide the chip in that case. */
  estimate: {
    source: WebSearchPricing["source"];
    creditsPerCall: number | null;
  };
}

export function formatSearchCostLabel(input: FormatSearchCostInput): string {
  if (input.creditsUsed != null) {
    return `${input.creditsUsed} credit${input.creditsUsed === 1 ? "" : "s"}`;
  }
  if (input.estimate.creditsPerCall == null) {
    return "";
  }
  return `~${input.estimate.creditsPerCall} credits`;
}
