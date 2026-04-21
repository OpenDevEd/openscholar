import type { LucideIcon } from "lucide-react";
import {
  CreditCard,
  Gift,
  Hourglass,
  Languages,
  ListChecks,
  MessageSquare,
  Network,
  Search,
  Sparkles,
  Undo2,
  Wallet,
  Zap,
} from "lucide-react";

export const TRANSACTION_TYPES = [
  "purchase",
  "usage",
  "grant",
  "refund",
  "expiry",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const CREDIT_TYPES = ["free", "paid"] as const;
export type CreditType = (typeof CREDIT_TYPES)[number];

export const BILLING_TYPES = [
  "extraction_llm",
  "embedding",
  "screening",
  "chat",
  "search",
  "translation",
  "wallet_api",
] as const;
export type BillingType = (typeof BILLING_TYPES)[number];

export type CssVar =
  | "--chart-1"
  | "--chart-2"
  | "--chart-3"
  | "--chart-4"
  | "--chart-5"
  | "--muted-foreground"
  | "--destructive";

interface TypePresentation {
  icon: LucideIcon;
  colorVar: CssVar;
  i18nKey: string;
  direction: "in" | "out";
}

export const TYPE_PRESENTATION: Readonly<Record<TransactionType, TypePresentation>> = {
  purchase: {
    icon: CreditCard,
    colorVar: "--chart-2",
    i18nKey: "type.purchase",
    direction: "in",
  },
  grant: {
    icon: Gift,
    colorVar: "--chart-3",
    i18nKey: "type.grant",
    direction: "in",
  },
  refund: {
    icon: Undo2,
    colorVar: "--chart-1",
    i18nKey: "type.refund",
    direction: "in",
  },
  usage: {
    icon: Zap,
    colorVar: "--muted-foreground",
    i18nKey: "type.usage",
    direction: "out",
  },
  expiry: {
    icon: Hourglass,
    colorVar: "--destructive",
    i18nKey: "type.expiry",
    direction: "out",
  },
};

export const BILLING_TYPE_ICON: Readonly<Record<BillingType, LucideIcon>> = {
  extraction_llm: Sparkles,
  embedding: Network,
  screening: ListChecks,
  chat: MessageSquare,
  search: Search,
  translation: Languages,
  wallet_api: Wallet,
};

export function presentationFor(type: TransactionType): TypePresentation {
  return TYPE_PRESENTATION[type];
}
