import type { LucideIcon } from "lucide-react";
import {
  CreditCard,
  Gift,
  Hourglass,
  ListChecks,
  MessageSquare,
  Network,
  Sparkles,
  Undo2,
  Zap,
} from "lucide-react";

export type TransactionType =
  | "purchase"
  | "usage"
  | "grant"
  | "refund"
  | "expiry";

export type CreditType = "free" | "paid";

export type BillingType =
  | "extraction_llm"
  | "embedding"
  | "screening"
  | "chat";

export type CssVar =
  | "--chart-1"
  | "--chart-2"
  | "--chart-3"
  | "--chart-4"
  | "--chart-5"
  | "--muted-foreground"
  | "--destructive";

export interface TypePresentation {
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
};

export function presentationFor(type: TransactionType): TypePresentation {
  return TYPE_PRESENTATION[type];
}
