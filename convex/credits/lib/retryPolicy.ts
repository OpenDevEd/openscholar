export const CREDIT_GRANT_RETRY_DELAYS_MS = [
  5_000,
  15_000,
  30_000,
  60_000,
  120_000,
  300_000,
] as const;

export const MAX_CREDIT_GRANT_RETRIES = CREDIT_GRANT_RETRY_DELAYS_MS.length;

export function shouldRetryCreditGrant(attempt: number): boolean {
  return attempt >= 0 && attempt < MAX_CREDIT_GRANT_RETRIES;
}

export function getCreditGrantRetryDelayMs(attempt: number): number | null {
  if (!shouldRetryCreditGrant(attempt)) {
    return null;
  }
  return CREDIT_GRANT_RETRY_DELAYS_MS[attempt] ?? null;
}
