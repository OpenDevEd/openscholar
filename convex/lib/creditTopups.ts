export const CREDIT_TOPUP_CURRENCY = "usd" as const;
export const DEFAULT_CREDITS_PER_USD = 10_000;

export const CREDIT_TOPUP_BUNDLES = [
  { key: "credits_10000", credits: 10_000 },
  { key: "credits_50000", credits: 50_000 },
  { key: "credits_100000", credits: 100_000 },
] as const;

export type CreditTopupBundleKey = (typeof CREDIT_TOPUP_BUNDLES)[number]["key"];

export type CreditTopupBundle = {
  key: CreditTopupBundleKey;
  credits: number;
  amountCents: number;
  currency: typeof CREDIT_TOPUP_CURRENCY;
};

function parsePositiveInteger(input: string | undefined): number | null {
  if (!input) return null;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function getCreditsPerUsd(): number {
  return parsePositiveInteger(process.env.CREDITS_PER_USD) ?? DEFAULT_CREDITS_PER_USD;
}

export function convertDollarsToCredits(
  dollars: number,
  creditsPerUsd = getCreditsPerUsd(),
): number {
  if (!Number.isFinite(dollars) || dollars <= 0) return 0;
  return Math.max(1, Math.ceil(dollars * creditsPerUsd));
}

export function convertCreditsToAmountCents(
  credits: number,
  creditsPerUsd = getCreditsPerUsd(),
): number {
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  return Math.ceil((credits * 100) / creditsPerUsd);
}

export function getCreditTopupCatalog(
  creditsPerUsd = getCreditsPerUsd(),
): CreditTopupBundle[] {
  return CREDIT_TOPUP_BUNDLES.map((bundle) => ({
    key: bundle.key,
    credits: bundle.credits,
    amountCents: convertCreditsToAmountCents(bundle.credits, creditsPerUsd),
    currency: CREDIT_TOPUP_CURRENCY,
  }));
}

export function getCreditTopupBundle(
  bundleKey: string,
  creditsPerUsd = getCreditsPerUsd(),
): CreditTopupBundle | null {
  const bundle = CREDIT_TOPUP_BUNDLES.find((row) => row.key === bundleKey);
  if (!bundle) return null;
  return {
    key: bundle.key,
    credits: bundle.credits,
    amountCents: convertCreditsToAmountCents(bundle.credits, creditsPerUsd),
    currency: CREDIT_TOPUP_CURRENCY,
  };
}

export function calculateRefundTargetCredits(args: {
  purchasedCredits: number;
  purchaseAmountCents: number;
  refundedAmountCents: number;
}): number {
  const purchasedCredits = Math.max(0, Math.floor(args.purchasedCredits));
  const purchaseAmountCents = Math.max(0, Math.floor(args.purchaseAmountCents));
  const refundedAmountCents = Math.max(0, Math.floor(args.refundedAmountCents));

  if (purchasedCredits <= 0 || purchaseAmountCents <= 0 || refundedAmountCents <= 0) {
    return 0;
  }

  if (refundedAmountCents >= purchaseAmountCents) {
    return purchasedCredits;
  }

  return Math.min(
    purchasedCredits,
    Math.floor((purchasedCredits * refundedAmountCents) / purchaseAmountCents),
  );
}

export function calculateRefundDeltaCredits(args: {
  targetReversedCredits: number;
  alreadyReversedCredits: number;
}): number {
  const target = Math.max(0, Math.floor(args.targetReversedCredits));
  const already = Math.max(0, Math.floor(args.alreadyReversedCredits));
  return Math.max(0, target - already);
}
