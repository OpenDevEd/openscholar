import type { Doc } from "@/convex/_generated/dataModel";
import { extractOpenalexRef } from "./openalex-id";
import type { BillingType, CreditType, TransactionType } from "./presentation";
import { humanizeModelId } from "./row-model-label";
import { formatTokenUsageSummary, parseTokensFromMetadata } from "./row-tokens";

export interface TransactionViewModel {
  id: string;
  type: TransactionType;
  creditType: CreditType;
  billingType: BillingType | null;

  direction: "in" | "out";
  amount: number;
  signedAmount: number;

  description: string | null;
  createdAt: number;

  jobId: string | null;
  paperId: string | null;
  resultId: string | null;

  stripeInvoiceId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeCheckoutSessionId: string | null;

  metadata: Record<string, string>;
  hasStripe: boolean;

  paperTitle: string | null;
  jobName: string | null;
  openalexRef: string | null;
  modelLabel: string | null;
  tokenSummary: string | null;
}

type EnrichedTransactionDoc = Doc<"creditTransactions"> & {
  paperTitle?: string | null;
  jobName?: string | null;
};

export function toViewModel(doc: EnrichedTransactionDoc): TransactionViewModel {
  const direction: "in" | "out" = doc.amount >= 0 ? "in" : "out";
  const stripeInvoiceId = doc.stripeInvoiceId ?? null;
  const stripePaymentIntentId = doc.stripePaymentIntentId ?? null;
  const stripeChargeId = doc.stripeChargeId ?? null;
  const stripeCheckoutSessionId = doc.stripeCheckoutSessionId ?? null;
  const metadata = doc.metadata ?? {};
  const billingType = normalizeBillingType(doc.billingType, metadata);
  const openalexRef = extractOpenalexRef(metadata);
  const modelLabel = humanizeModelId(metadata.model);
  const tokenSummary = formatTokenUsageSummary(parseTokensFromMetadata(metadata));
  return {
    id: doc._id,
    type: doc.type,
    creditType: doc.creditType,
    billingType,
    direction,
    amount: Math.abs(doc.amount),
    signedAmount: doc.amount,
    description: doc.description ?? null,
    createdAt: doc.createdAt,
    jobId: doc.jobId ?? null,
    paperId: doc.paperId ?? null,
    resultId: doc.resultId ?? null,
    stripeInvoiceId,
    stripePaymentIntentId,
    stripeChargeId,
    stripeCheckoutSessionId,
    metadata,
    hasStripe:
      stripeInvoiceId !== null ||
      stripePaymentIntentId !== null ||
      stripeChargeId !== null ||
      stripeCheckoutSessionId !== null,
    paperTitle: doc.paperTitle ?? null,
    jobName: doc.jobName ?? null,
    openalexRef,
    modelLabel,
    tokenSummary,
  };
}

function normalizeBillingType(
  typed: BillingType | null | undefined,
  metadata: Record<string, string>,
): BillingType | null {
  if (typed) return typed;
  const fromMeta = metadata.billingType;
  if (fromMeta === "screening") return "screening";
  if (fromMeta === "extraction_llm") return "extraction_llm";
  if (fromMeta === "embedding") return "embedding";
  if (fromMeta === "chat") return "chat";
  if (fromMeta === "search") return "search";
  if (fromMeta === "translation") return "translation";
  if (fromMeta === "wallet_api") return "wallet_api";
  return null;
}
