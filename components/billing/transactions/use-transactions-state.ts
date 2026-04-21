"use client";

import {
  parseAsArrayOf,
  parseAsIsoDateTime,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import {
  BILLING_TYPES,
  CREDIT_TYPES,
  TRANSACTION_TYPES,
  type BillingType,
  type CreditType,
  type TransactionType,
} from "@/lib/billing/transactions/presentation";

export { BILLING_TYPES, CREDIT_TYPES as CREDIT_POOLS, TRANSACTION_TYPES };
export type TransactionTypeParam = TransactionType;
export type CreditPoolParam = CreditType;
export type BillingTypeParam = BillingType;

export const SORT_FIELDS = ["date", "amount", "type"] as const;
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const VIEW_TABS = [
  "all",
  "purchases",
  "usage",
  "refunds-grants",
  "failed",
] as const;

export type SortField = (typeof SORT_FIELDS)[number];
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
export type Density = (typeof DENSITIES)[number];
export type ViewTab = (typeof VIEW_TABS)[number];

export const transactionsStateSchema = {
  view: parseAsStringLiteral(VIEW_TABS).withDefault("all"),

  q: parseAsString.withDefault(""),

  types: parseAsArrayOf(parseAsStringLiteral(TRANSACTION_TYPES)).withDefault([]),
  creditPools: parseAsArrayOf(parseAsStringLiteral(CREDIT_TYPES)).withDefault([]),
  billingTypes: parseAsArrayOf(parseAsStringLiteral(BILLING_TYPES)).withDefault([]),
  from: parseAsIsoDateTime,
  to: parseAsIsoDateTime,

  sort: parseAsStringLiteral(SORT_FIELDS).withDefault("date"),
  sortDir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault("desc"),

  density: parseAsStringLiteral(DENSITIES).withDefault("comfortable"),
};

export type TransactionsState = {
  view: ViewTab;
  q: string;
  types: TransactionTypeParam[];
  creditPools: CreditPoolParam[];
  billingTypes: BillingTypeParam[];
  from: Date | null;
  to: Date | null;
  sort: SortField;
  sortDir: SortDirection;
  density: Density;
};

export type TransactionsStateUpdate = Partial<TransactionsState>;

export function useTransactionsState() {
  return useQueryStates(transactionsStateSchema, {
    history: "replace",
    shallow: true,
    clearOnDefault: true,
  });
}

export function presetForView(view: ViewTab): TransactionsStateUpdate {
  switch (view) {
    case "purchases":
      return { types: ["purchase"] };
    case "usage":
      return { types: ["usage"] };
    case "refunds-grants":
      return { types: ["refund", "grant"] };
    case "failed":
      return { types: ["expiry"] };
    case "all":
    default:
      return { types: [] };
  }
}
