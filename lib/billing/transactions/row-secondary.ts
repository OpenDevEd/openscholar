import type { TransactionViewModel } from "./transaction-view-model";

export type SecondaryPart =
  | { kind: "literal"; text: string }
  | { kind: "translated"; key: string; values?: Record<string, string | number> };

/**
 * Returns the ordered parts of the row's secondary line. The caller joins
 * them with " · " (or locale equivalent) after translating each part.
 *
 * Parts never include the timestamp — that's appended by the component
 * using `useFormatter().relativeTime()` so locale stays next-intl-driven.
 */
export function resolveSecondaryParts(row: TransactionViewModel): SecondaryPart[] {
  switch (row.type) {
    case "purchase": {
      const parts: SecondaryPart[] = [{ kind: "translated", key: "secondary.topup" }];
      if (row.hasStripe) parts.push({ kind: "translated", key: "secondary.stripe" });
      return parts;
    }
    case "grant": {
      const source = row.metadata.grantSource;
      const parts: SecondaryPart[] = [];
      if (source) parts.push({ kind: "literal", text: source });
      return parts;
    }
    case "refund": {
      return row.hasStripe
        ? [{ kind: "translated", key: "secondary.stripeRefund" }]
        : [];
    }
    case "expiry":
      return [{ kind: "translated", key: "secondary.expired" }];
    case "usage": {
      if (row.billingType === "chat" || row.billingType === "wallet_api") {
        if (row.modelLabel || row.tokenSummary) {
          const parts: SecondaryPart[] = [];
          if (row.modelLabel) parts.push({ kind: "literal", text: row.modelLabel });
          if (row.tokenSummary) parts.push({ kind: "literal", text: row.tokenSummary });
          return parts;
        }
      }
      const serviceKey = serviceKeyFor(row.billingType);
      if (!serviceKey) return [];
      return [{ kind: "translated", key: serviceKey }];
    }
  }
}

function serviceKeyFor(
  billingType: TransactionViewModel["billingType"],
): string | null {
  if (billingType === "extraction_llm") return "billingType.extraction_llm";
  if (billingType === "embedding") return "billingType.embedding";
  if (billingType === "screening") return "billingType.screening";
  if (billingType === "chat") return "billingType.chat";
  if (billingType === "search") return "billingType.search";
  if (billingType === "translation") return "billingType.translation";
  if (billingType === "wallet_api") return "billingType.wallet_api";
  return null;
}
