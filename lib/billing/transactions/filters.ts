import type { BillingType, CreditType, TransactionType } from "./presentation";
import type { TransactionViewModel } from "./transaction-view-model";

export interface FilterState {
  types: readonly TransactionType[];
  creditPools: readonly CreditType[];
  billingTypes: readonly BillingType[];
  dateRange: { from: number; to: number } | null;
  search: string;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  types: [],
  creditPools: [],
  billingTypes: [],
  dateRange: null,
  search: "",
};

export function isFilterActive(state: FilterState): boolean {
  return (
    state.types.length > 0 ||
    state.creditPools.length > 0 ||
    state.billingTypes.length > 0 ||
    state.dateRange !== null ||
    state.search.trim().length > 0
  );
}

export function buildFilterPredicate(
  state: FilterState,
): (row: TransactionViewModel) => boolean {
  const typeSet = state.types.length > 0 ? new Set(state.types) : null;
  const poolSet = state.creditPools.length > 0 ? new Set(state.creditPools) : null;
  const billingSet = state.billingTypes.length > 0 ? new Set(state.billingTypes) : null;
  const search = state.search.trim().toLowerCase();
  const range = state.dateRange;

  return (row) => {
    if (typeSet && !typeSet.has(row.type)) return false;
    if (poolSet && !poolSet.has(row.creditType)) return false;
    if (billingSet) {
      if (row.billingType === null || !billingSet.has(row.billingType)) return false;
    }
    if (range) {
      if (row.createdAt < range.from || row.createdAt > range.to) return false;
    }
    if (search.length > 0) {
      if (row.description === null) return false;
      if (!row.description.toLowerCase().includes(search)) return false;
    }
    return true;
  };
}

export interface ServerFilterArgs {
  types?: readonly TransactionType[];
  creditPools?: readonly CreditType[];
  billingTypes?: readonly BillingType[];
  q?: string;
  from?: number;
  to?: number;
}

export function toServerFilterArgs(state: FilterState): ServerFilterArgs {
  const args: ServerFilterArgs = {};
  if (state.types.length > 0) args.types = state.types;
  if (state.creditPools.length > 0) args.creditPools = state.creditPools;
  if (state.billingTypes.length > 0) args.billingTypes = state.billingTypes;
  const trimmedSearch = state.search.trim();
  if (trimmedSearch.length > 0) args.q = trimmedSearch;
  if (state.dateRange) {
    args.from = state.dateRange.from;
    args.to = state.dateRange.to;
  }
  return args;
}
