import type { Doc } from "@/convex/_generated/dataModel";
import type { BillingType, CreditType, TransactionType } from "./presentation";

export interface TransactionViewModel {
  id: string;
  type: TransactionType;
  creditType: CreditType;
  billingType: BillingType | null;

  direction: "in" | "out";
  amount: number;
  signedAmount: number;
  balanceAfter: number;

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
}

export function toViewModel(doc: Doc<"creditTransactions">): TransactionViewModel {
  const direction: "in" | "out" = doc.amount >= 0 ? "in" : "out";
  const stripeInvoiceId = doc.stripeInvoiceId ?? null;
  const stripePaymentIntentId = doc.stripePaymentIntentId ?? null;
  const stripeChargeId = doc.stripeChargeId ?? null;
  const stripeCheckoutSessionId = doc.stripeCheckoutSessionId ?? null;
  return {
    id: doc._id,
    type: doc.type,
    creditType: doc.creditType,
    billingType: doc.billingType ?? null,
    direction,
    amount: Math.abs(doc.amount),
    signedAmount: doc.amount,
    balanceAfter: doc.balanceAfter,
    description: doc.description ?? null,
    createdAt: doc.createdAt,
    jobId: doc.jobId ?? null,
    paperId: doc.paperId ?? null,
    resultId: doc.resultId ?? null,
    stripeInvoiceId,
    stripePaymentIntentId,
    stripeChargeId,
    stripeCheckoutSessionId,
    metadata: doc.metadata ?? {},
    hasStripe:
      stripeInvoiceId !== null ||
      stripePaymentIntentId !== null ||
      stripeChargeId !== null ||
      stripeCheckoutSessionId !== null,
  };
}
