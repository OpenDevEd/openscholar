export function hasEnoughCredits({
  balance,
  required,
}: {
  balance: { total: number } | null | undefined;
  required: number;
}): boolean {
  if (!balance) return false;
  return balance.total >= required;
}

export type CreditsSettlement = "loading" | "settled" | "error";

export type CreditsAvailability = "available" | "unavailable" | "unknown";

export function resolveCreditsAvailability({
  totalCredits,
  requiredCredits,
  settlement,
  isAuthenticated,
}: {
  totalCredits: number | undefined;
  requiredCredits: number;
  settlement: CreditsSettlement;
  isAuthenticated: boolean;
}): CreditsAvailability {
  if (!isAuthenticated || settlement !== "settled") {
    return "unknown";
  }
  return (totalCredits ?? 0) >= requiredCredits ? "available" : "unavailable";
}
