export interface FormatSearchCostInput {
  creditsUsed?: number;
  creditsPerSearchEstimate: number;
  costUsdEstimate: number;
}

export function formatSearchCostLabel(input: FormatSearchCostInput): string {
  const { creditsUsed, creditsPerSearchEstimate, costUsdEstimate } = input;
  if (creditsUsed != null) {
    return `${creditsUsed} credit${creditsUsed === 1 ? "" : "s"}`;
  }
  return `~$${costUsdEstimate.toFixed(2)} / ~${creditsPerSearchEstimate} credits`;
}
