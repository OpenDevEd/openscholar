export function normalizeStripeWebhookSecret(
  raw: string | undefined | null,
): string | undefined {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) {
    return undefined;
  }

  const whsecIndex = trimmed.indexOf("whsec_");
  if (whsecIndex >= 0) {
    return trimmed.slice(whsecIndex);
  }

  return trimmed;
}
