# Perf baselines

Reference numbers from the Vitest `bench` runner. Re-run after any change
to the underlying pipeline (`toViewModel`, `buildFilterPredicate`,
`partitionByGroup`, `toCsv`) to spot regressions:

```bash
npm run bench:transactions
```

These are **guidance, not CI gates**. If a number exceeds the target by
2× or more, profile before optimizing — React Compiler's auto-memoization
may already cover the call site.

## Environment

| | |
|---|---|
| Hardware | M-series Mac, default Vitest pool |
| Node | as resolved by `nvm use` (or system) |
| Vitest | `^3.2.4` |
| Fixture seed | `0xC01DFEED` (mulberry32) |
| Timezone | UTC for benches; resolved tz at runtime in production |

## `tests/perf/billing-transactions.bench.ts` — plan-06

### transactions pipeline @ 500 rows

| name                              | mean    | p99    | hz      | target  | margin |
|-----------------------------------|--------:|-------:|--------:|--------:|-------:|
| `toViewModel`                     | 0.007 ms| 0.04 ms| 149,272 | < 1 ms  | 140×   |
| `filter (purchase + usage)`       | 0.002 ms| 0.00 ms| 509,004 | < 2 ms  | 1000×  |
| `partition by group`              | 1.77 ms | 3.74 ms| 566     | < 3 ms  | ~1.7×  |
| `toCsv`                           | 0.397 ms| 0.51 ms| 2,521   | < 5 ms  | 12×    |

### transactions pipeline @ 1000 rows

| name                              | mean    | p99    | hz      | rule                | margin |
|-----------------------------------|--------:|-------:|--------:|---------------------|-------:|
| `toViewModel`                     | 0.013 ms| 0.07 ms| 79,881  | < 2× the 500 value  | 1.9×   |
| `filter (no active filters)`      | 0.002 ms| 0.00 ms| 556,263 | < 2× the 500 value  | 0.9×*  |
| `partition by group`              | 3.37 ms | 3.59 ms| 297     | < 2× the 500 value  | 1.9×   |
| `toCsv`                           | 0.792 ms| 0.94 ms| 1,263   | < 2× the 500 value  | 2.0×   |

\* The 1000-row filter is faster than the 500-row filter because the
1000-row run uses the no-filter predicate (no Set lookups) while the
500-row run uses `types ∈ {purchase, usage}`. Apples-to-oranges by
design — both bench distinct call sites.

### transactions filter — search path @ 500 rows

| name                              | mean    | p99    | hz      |
|-----------------------------------|--------:|-------:|--------:|
| `filter (search: short prefix)`   | 0.009 ms| 0.01 ms| 115,060 |
| `filter (search: no match)`       | 0.007 ms| 0.01 ms| 134,512 |

## Notes / known regressions

- **2026-04-20 / plan-06:** Initial run showed `partition by group` at
  ~35 ms (500 rows) and ~57 ms (1000 rows) — 11× over target.
  Root cause: `Intl.DateTimeFormat` was being constructed once per row
  inside `calendarParts`. Fix: cache one formatter per `tz` at module
  scope (`FORMATTER_CACHE` in `lib/billing/transactions/grouping.ts`).
  After the fix, the 500-row partition dropped 20× to 1.77 ms and the
  1000-row partition dropped 17× to 3.37 ms — both inside target.
