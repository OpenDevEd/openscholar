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
