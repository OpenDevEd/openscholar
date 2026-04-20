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
