import { bench, describe } from "vitest";

import { toViewModel } from "@/lib/billing/transactions/transaction-view-model";
import {
  DEFAULT_FILTER_STATE,
  buildFilterPredicate,
} from "@/lib/billing/transactions/filters";
import { partitionByGroup } from "@/lib/billing/transactions/grouping";
import { toCsv } from "@/lib/billing/transactions/export-csv";

import { generateFixture } from "./fixtures/transactions";

// 2026-04-20T12:00:00Z — must match the fixture's internal `nowMs` so that
// partitioning hits every bucket (today / yesterday / this-week / last-week
// / month-*).
const BENCH_NOW = Date.UTC(2026, 3, 20, 12, 0, 0);
const TZ = "UTC";

describe("transactions pipeline @ 500 rows", () => {
  const docs = generateFixture(500);
  const viewModels = docs.map(toViewModel);
  const filterState = {
    ...DEFAULT_FILTER_STATE,
    types: ["purchase", "usage"] as const,
  };
  const predicate = buildFilterPredicate(filterState);

  bench("toViewModel", () => {
    docs.map(toViewModel);
  });

  bench("filter (types: purchase + usage)", () => {
    viewModels.filter(predicate);
  });

  bench("partition by group", () => {
    partitionByGroup(viewModels, BENCH_NOW, TZ);
  });

  bench("toCsv", () => {
    toCsv(viewModels);
  });
});

describe("transactions pipeline @ 1000 rows", () => {
  const docs = generateFixture(1000);
  const viewModels = docs.map(toViewModel);
  const predicate = buildFilterPredicate(DEFAULT_FILTER_STATE);

  bench("toViewModel", () => {
    docs.map(toViewModel);
  });

  bench("filter (no active filters)", () => {
    viewModels.filter(predicate);
  });

  bench("partition by group", () => {
    partitionByGroup(viewModels, BENCH_NOW, TZ);
  });

  bench("toCsv", () => {
    toCsv(viewModels);
  });
});

describe("transactions filter — search path @ 500 rows", () => {
  const docs = generateFixture(500);
  const viewModels = docs.map(toViewModel);
  const shortSearch = buildFilterPredicate({
    ...DEFAULT_FILTER_STATE,
    search: "pro",
  });
  const noMatch = buildFilterPredicate({
    ...DEFAULT_FILTER_STATE,
    search: "zzzzzzzzz",
  });

  bench("filter (search: short prefix)", () => {
    viewModels.filter(shortSearch);
  });

  bench("filter (search: no match)", () => {
    viewModels.filter(noMatch);
  });
});
