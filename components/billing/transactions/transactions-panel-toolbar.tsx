"use client";

import { useMemo, useTransition } from "react";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  LayoutList,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { isFilterActive } from "@/lib/billing/transactions/filters";

import { DateRangePicker } from "./date-range-picker";
import {
  FilterMultiSelect,
  type FilterOption,
} from "./filter-multi-select";
import {
  BILLING_TYPES,
  CREDIT_POOLS,
  DENSITIES,
  SORT_DIRECTIONS,
  SORT_FIELDS,
  TRANSACTION_TYPES,
  type BillingTypeParam,
  type CreditPoolParam,
  type Density,
  type SortDirection,
  type SortField,
  type TransactionTypeParam,
  useTransactionsState,
} from "./use-transactions-state";

const DENSITY_STORAGE_KEY = "billing.transactions.density";

interface Props {
  counts: Record<string, number>;
}

export function TransactionsPanelToolbar({ counts }: Props) {
  const t = useTranslations("billingPage.transactions");
  const tType = useTranslations("billingPage.transactions.type");
  const tBilling = useTranslations("billingPage.transactions.billingType");
  const tPool = useTranslations(
    "billingPage.transactions.filters.creditPoolValues",
  );
  const [state, setState] = useTransactionsState();
  const [, startFilterTransition] = useTransition();

  const typeOptions = useMemo<FilterOption<TransactionTypeParam>[]>(
    () =>
      TRANSACTION_TYPES.map((value) => ({
        value,
        label: tType(value),
        count: counts[`type:${value}`] ?? 0,
      })),
    [counts, tType],
  );

  const creditPoolOptions = useMemo<FilterOption<CreditPoolParam>[]>(
    () =>
      CREDIT_POOLS.map((value) => ({
        value,
        label: tPool(value),
        count: counts[`creditPool:${value}`] ?? 0,
      })),
    [counts, tPool],
  );

  const billingTypeOptions = useMemo<FilterOption<BillingTypeParam>[]>(
    () =>
      BILLING_TYPES.map((value) => ({
        value,
        label: tBilling(value),
        count: counts[`billingType:${value}`] ?? 0,
      })),
    [counts, tBilling],
  );

  const usageVisible =
    state.types.length === 0 || state.types.includes("usage");

  const activeFilter = isFilterActive({
    types: state.types,
    creditPools: state.creditPools,
    billingTypes: state.billingTypes,
    dateRange:
      state.from && state.to
        ? { from: state.from.getTime(), to: state.to.getTime() }
        : null,
    search: state.q,
  });

  return (
    <div
      data-transactions-toolbar
      data-transactions-filter-active={activeFilter ? "true" : "false"}
      className="flex flex-col gap-2 border-b border-border/50 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={state.q}
            onChange={(e) => {
              const next = e.target.value;
              startFilterTransition(() => {
                void setState({ q: next });
              });
            }}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            data-transactions-search
            className="h-8 pl-8 pr-8 text-sm"
          />
          {state.q.length > 0 && (
            <button
              type="button"
              onClick={() => void setState({ q: "" })}
              aria-label={t("searchClear")}
              data-transactions-search-clear
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <FilterMultiSelect<TransactionTypeParam>
          label={t("filters.type")}
          facet="type"
          options={typeOptions}
          value={state.types}
          onChange={(next) => {
            startFilterTransition(() => {
              void setState({ types: [...next] });
            });
          }}
        />

        <FilterMultiSelect<CreditPoolParam>
          label={t("filters.creditPool")}
          facet="creditPool"
          options={creditPoolOptions}
          value={state.creditPools}
          onChange={(next) => {
            startFilterTransition(() => {
              void setState({ creditPools: [...next] });
            });
          }}
        />

        {usageVisible && (
          <FilterMultiSelect<BillingTypeParam>
            label={t("filters.billingType")}
            facet="billingType"
            options={billingTypeOptions}
            value={state.billingTypes}
            onChange={(next) => {
              startFilterTransition(() => {
                void setState({ billingTypes: [...next] });
              });
            }}
          />
        )}

        <DateRangePicker
          from={state.from}
          to={state.to}
          onChange={(range) => {
            startFilterTransition(() => {
              void setState({ from: range.from, to: range.to });
            });
          }}
        />

        {activeFilter && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              void setState({
                q: "",
                types: [],
                creditPools: [],
                billingTypes: [],
                from: null,
                to: null,
                view: "all",
              })
            }
            data-transactions-clear-all
          >
            {t("clearAll")}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-transactions-sort-trigger
              data-sort-field={state.sort}
              data-sort-dir={state.sortDir}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <ArrowUpDown
                className="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="font-medium">{t(`sort.${state.sort}`)}</span>
              {state.sortDir === "asc" ? (
                <ArrowUp
                  className="size-3 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <ArrowDown
                  className="size-3 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuLabel className="text-xs">
              {t("sort.label")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={state.sort}
              onValueChange={(v) =>
                void setState({ sort: v as SortField })
              }
            >
              {SORT_FIELDS.map((f) => (
                <DropdownMenuRadioItem
                  key={f}
                  value={f}
                  className="text-xs"
                  data-sort-option={f}
                >
                  {t(`sort.${f}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={state.sortDir}
              onValueChange={(v) =>
                void setState({ sortDir: v as SortDirection })
              }
            >
              {SORT_DIRECTIONS.map((d) => (
                <DropdownMenuRadioItem
                  key={d}
                  value={d}
                  className="text-xs"
                  data-sort-dir-option={d}
                >
                  {t(`sort.dir.${d}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              data-transactions-density-trigger
              data-density={state.density}
            >
              <LayoutList
                className="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              {t(`density.${state.density}`)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuLabel className="text-xs">
              {t("density.label")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={state.density}
              onValueChange={(v) => {
                const next = v as Density;
                void setState({ density: next });
                if (typeof window !== "undefined") {
                  try {
                    window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
                  } catch {
                    // ignore: private mode / quota — non-essential persistence
                  }
                }
              }}
            >
              {DENSITIES.map((d) => (
                <DropdownMenuRadioItem
                  key={d}
                  value={d}
                  className="text-xs"
                  data-density-option={d}
                >
                  {t(`density.${d}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
