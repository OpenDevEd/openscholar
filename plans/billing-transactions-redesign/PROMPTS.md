# Billing Transactions Redesign — Execution Prompts

One copy-paste prompt per plan, designed to be pasted into a fresh `/clear`'d Claude Code session. Each prompt is self-contained: the agent doesn't need to have seen the planning conversation.

**Before any prompt:** ensure you're on `dev` branch with a clean working tree; `git log -1` to confirm the previous plan's commits landed if chaining.

---

## Plan 01 — Data Foundation: Pure Logic + Paginated Query

```
Execute `plans/billing-transactions-redesign/01-data-foundation.md` from top to bottom. Follow the plan file's §TDD sequence — Red → Green → Commit per test case — across all five pure-logic modules (presentation, formatters, grouping, filters, transaction-view-model). No implementation of a module until its tests are written.

Order of operations:
1. Create `lib/billing/transactions/` directory.
2. TDD `presentation.ts` (icon + tint + label maps, billing-type sub-icons).
3. TDD `formatters.ts` (signed amount with Unicode minus U+2212, balance, relative time with DST safety).
4. TDD `grouping.ts` (today/yesterday/this-week/last-week/month buckets, partition, shouldRenderGroups).
5. TDD `filters.ts` (DEFAULT_FILTER_STATE, isFilterActive, buildFilterPredicate, toServerFilterArgs).
6. TDD `transaction-view-model.ts` (toViewModel projection with direction + hasStripe derivation).
7. Extend `convex/credits/queries.ts:getTransactions` with `paginationOpts`, `types`, `from`, `to` args. Keep the unpaginated branch backwards-compatible for the single existing caller.
8. Write `convex-test` cases for the paginated branch: backwards-compat, happy path, type filter (index + post-filter), date range, ownership, empty user.

Delegation rules:
- BEFORE step 7: spawn one Explore agent to grep every caller of `api.credits.queries.getTransactions` across the repo. Plan assumes exactly one external caller (`components/billing/transactions-list.tsx:37`). If more, stop and report.
- BEFORE writing the Convex branch: spawn one general-purpose agent to read the current `stack.convex.dev` docs on `usePaginatedQuery` + `paginationOptsValidator` + the pin-endpoints model, and return the exact signature shape for return-type inference. Our plan references `PaginationResult<T>`; verify the import path.
- If the Convex union-return-validator inference is painful, split into two queries (`getTransactions` old + `listTransactionsPaginated` new) as the plan allows.

Acceptance criteria are explicit in §Acceptance — tick every box before concluding. The most important behavioral assertion: `grep -rn "getTransactions" components/ convex/` shows one external consumer and one new test file.

Testing doctrine — non-negotiable: assert on `data-*`, ARIA, `getByRole`/`getByText`/`getByLabelText`. Never assert on className or Tailwind strings. See project root `CLAUDE.md`.

Commit discipline: one commit per TDD green, then one commit for the Convex migration + its tests. Prefix: `feat(billing-txn): [plan-01] <module> — <what>`.

Main-session protection: spawn subagents for anything beyond 3 file reads / 3 greps. Never ship UI changes in this plan — plan 01 is invisible groundwork only.
```

---

## Plan 02 — Row Redesign: Icon, Amount, StatusPill, Typography

```
Execute `plans/billing-transactions-redesign/02-row-redesign.md` top to bottom. Plan 01 must be committed on `dev` before starting.

Order of operations:
1. Add `lucide-react` to `next.config.ts`'s `experimental.optimizePackageImports`. Verify via `npm view next@<installed-version>` that the key is still called `optimizePackageImports` and not renamed.
2. Append `.txn-pulse` keyframes + `prefers-reduced-motion` override to `app/globals.css`. Grep first for the canonical location of global keyframes in this project.
3. Build `components/billing/transactions/transaction-icon.tsx` using the plan's CSS-var tint pattern (color-mix in oklch 12%). Verify browser support aligns with project `browserslist`.
4. Build `components/billing/transactions/transaction-amount.tsx` with Unicode minus sign (U+2212), tabular-nums, emerald for money-in, neutral for routine money-out, destructive only for failed/expired.
5. Build `components/billing/transactions/transaction-status-pill.tsx` — conditional render only for pending/failed/expired.
6. Build `components/billing/transactions/transaction-row.tsx` with `React.memo` + custom equality, role="listitem", every `data-*` attribute listed in the plan's §4, aria-label summarizing the transaction.
7. Refactor `components/billing/transactions-list.tsx` to render `<TransactionRow>` via `toViewModel(doc)` inside useMemo; swap `<ul>` → `<div role="list">`.
8. Add i18n keys under `billingPage.transactions.{type,billingType,status,actions}` in `messages/en-US.json`.
9. Write RTL behavior tests per §Test plan (assert on data-*, never className).
10. Verify bundle: `next build --analyze` → `lucide-react` chunk < 10 KB.

Delegation rules:
- BEFORE step 1: spawn one general-purpose agent to confirm `optimizePackageImports` is the right key name in the installed Next version. Plan assumes Next 15/16.
- BEFORE step 3: spawn one Explore agent to verify that the project's `browserslist` supports `color-mix(in oklch, ...)`. If not, the plan has an inline fallback pattern — use it.
- BEFORE step 7: spawn one Explore agent to verify no other code depends on `<ul>`/`<li>` CSS selectors on the transactions list.

Acceptance criteria:
- Every row exposes `data-txn-type`, `data-txn-direction`, `data-txn-credit-type`, `data-txn-billing-type`, `data-txn-status`, `data-txn-density`, `data-txn-id`.
- Expired rows carry a left-border stripe and `data-txn-status="expired"`.
- Routine debits have default foreground text, NOT red.
- Money-in rows render emerald.
- Pending pill pulses at 1.6s; reduced-motion disables it.
- Bundle analyzer chunk check passes.
- Axe clean at 10 rows.

Commit discipline: one commit per new component (icon, amount, pill, row), one for the list refactor, one for next.config.ts + globals.css, one for i18n. Prefix: `feat(billing-txn): [plan-02] <what>`.

Non-negotiable:
- No CSS-class assertions.
- No emojis.
- Unicode minus (U+2212), not ASCII hyphen.
- `aria-hidden` on every decorative icon; row's aria-label carries the semantic description.
- `React.memo` comparator must include every prop (see plan §4 bottom).
```

---

## Plan 03 — Header, Date Grouping, Paginated Loading

```
Execute `plans/billing-transactions-redesign/03-header-grouping-pagination.md` top to bottom. Plans 01 + 02 must be committed on `dev`.

Order of operations:
1. Build `transactions-panel-header.tsx` with title + tabular-nums summary gauge + progress bar + `role="status" aria-live="polite"` region. Export button is stubbed (disabled); plan 05 wires it.
2. Build `transactions-group-header.tsx` with `position: sticky; top: 0` and backdrop-blur.
3. Build `use-transactions-load-more.ts` — IntersectionObserver with `rootMargin: "0px 0px 400px 0px"` gated on `status === "CanLoadMore"`.
4. Build `transactions-panel-client.tsx` consuming `useProtectedPaginatedQuery` with `initialNumItems: 25`; partition rows via `partitionByGroup` + `shouldRenderGroups`; render group headers between bucket boundaries; apply `content-visibility: auto; contain-intrinsic-size: 0 60px` to rows.
5. Build `transactions-panel.tsx` as the Server Component shell reading `searchParams` (jobId only at this stage) and rendering `<TransactionsPanelClient>` inside `<Suspense>`.
6. Build `transactions-list-skeleton.tsx` (6 rows matching comfortable density).
7. Wire `/settings/billing/page.tsx` to mount `<TransactionsPanel searchParams={searchParams} />` instead of `<TransactionsList />`. Keep `components/billing/transactions-list.tsx` as a thin re-export for this plan cycle; plan 04 removes it.
8. Add i18n keys under `group`, `summary`, `loadingMore`, `exhausted`, `export.label`.

Delegation rules:
- BEFORE step 3: spawn one general-purpose agent to confirm Next 15's App Router `searchParams` async prop pattern and nuqs `createSearchParamsCache` integration. This plan reads `searchParams` synchronously at the client boundary; plan 04 will migrate to the cache.
- BEFORE step 4: spawn one Explore agent to confirm `useProtectedPaginatedQuery`'s error/empty-state semantics in `lib/auth/use-auth-query.ts:117`. Plan assumes `status` returns one of `LoadingFirstPage | CanLoadMore | LoadingMore | Exhausted`.
- IF `content-visibility: auto` interacts badly with sticky group headers (flicker during scroll), narrow the selector to `[data-txn-row]` only — the plan's CSS already does this; verify at execution.

Acceptance criteria:
- Panel paginates via `useProtectedPaginatedQuery` starting at 25 items.
- IntersectionObserver triggers `loadMore(25)` when last row within 400px of viewport.
- `data-transactions-status` reflects the state machine.
- Group headers appear when sort is date-desc (hardcoded this plan; plan 04 wires sort state).
- `content-visibility: auto` applied; rows outside viewport skip layout/paint per DevTools Rendering panel.
- Header summary gauge shows `+in · −out · Net ±N` with tabular-nums.
- Single `role="status" aria-live="polite"` region for summary.
- Axe clean.
- Lighthouse LCP ≤ 1.8s on /settings/billing.

Commit discipline: one commit for the header, one for group headers, one for the IO hook, one for the panel client + server wiring + page mount, one for i18n. Prefix: `feat(billing-txn): [plan-03] <what>`.

Non-negotiable:
- No CSS-class assertions.
- Sticky headers use `role="presentation"` so axe doesn't complain.
- `aria-live="polite"` only once in this panel — never on row containers.
- Don't break the existing `?jobId=` URL flow; E2E specs must still pass.
```

---

## Plan 04 — Toolbar, Filters, Saved Views, URL State

```
Execute `plans/billing-transactions-redesign/04-toolbar-filters-views.md` top to bottom. Plans 01–03 must be committed.

Order of operations:
1. Write `use-transactions-state.ts` with the full nuqs schema (view, q, types, creditPools, billingTypes, from, to, sort, sortDir, density). Use `useQueryStates` with `history: "replace", shallow: true, clearOnDefault: true`.
2. Write `presetForView` mapping view → filter preset.
3. Write `lib/billing/transactions/sort.ts` (or extend `grouping.ts`) with `sortRows`; add 3 TDD cases.
4. Build `filter-multi-select.tsx` with Popover + checklist + tabular-nums counts + `role="listbox" aria-multiselectable="true"`.
5. Build `date-range-picker.tsx` with preset chips (today/7d/30d/90d/ytd/all) + shadcn Calendar (range mode). Verify `react-day-picker` is installed; if not, `npx shadcn@latest add calendar`.
6. Build `transactions-panel-toolbar.tsx` with search (deferred via `useDeferredValue`), filter popovers, clear-all, sort menu, density menu. Wrap filter keystrokes in `startTransition`. Surface `data-transactions-filter-active`, `data-search-deferred`.
7. Build `transactions-panel-tabs.tsx` with shadcn Tabs and `presetForView` on change.
8. Integrate into `transactions-panel-client.tsx`: pipe filter state into `useProtectedPaginatedQuery` args (types + from + to coarse-narrow server-side), apply `buildFilterPredicate` client-side for creditPools/billingTypes/search, sort via `sortRows`, render toolbar + tabs above the list, aria-busy on the list during transitions.
9. Add `aria-live="polite"` debounced count announcement ("Showing N of M transactions") — 500ms debounce minimum.
10. Update `transactions-panel.tsx` server shell to parse full state via `createSearchParamsCache`.
11. Remove `components/billing/transactions-list.tsx` re-export from plan 03 (grep for lingering imports; update them to `./transactions/transactions-panel`).
12. Add all new i18n keys.
13. Write RTL tests for each new component + extend the client-island test.

Delegation rules:
- BEFORE step 1: spawn one general-purpose agent to read the nuqs@^2.6 README and confirm `parseAsIsoDateTime`, `parseAsStringEnum`, `useQueryStates`, `createSearchParamsCache` APIs are as the plan uses them.
- BEFORE step 5: spawn one Explore agent to verify shadcn `Calendar` is in `components/ui/` and `react-day-picker` is in `package.json`. If not, `npx shadcn@latest add calendar`.
- BEFORE step 8: spawn one Explore agent to grep the `getTransactions` Convex handler and confirm it accepts `types`, `from`, `to` (plan 01 widened it). If any args are missing, fix in the handler first.
- The tabs + multi-select interaction has a known drift — if the user manually changes filters away from a preset, `view` becomes desynced from `types`. Plan says "acceptable for MVP"; do NOT over-engineer unless QA surfaces it.

Acceptance criteria:
- Full URL state via nuqs; shareable URLs restore filters deterministically.
- Server Component parses `searchParams` on first frame.
- Search uses `useDeferredValue`; `data-search-deferred` flag surfaces.
- `aria-busy` flips on list during transition.
- `aria-live` count debounced, announces once per settle.
- Grouping collapses when sort ≠ date-desc.
- All data-* attributes present per plan's §Contract.
- Axe clean on toolbar + tabs + list + popover.
- Existing ?jobId= E2E specs still pass.

Commit discipline: commit per module (schema, sort, multi-select, date-picker, toolbar, tabs, client integration, server-shell), then i18n. Prefix: `feat(billing-txn): [plan-04] <what>`.

Non-negotiable:
- Object-form nuqs writes only (`setState({ a, b })`). Never multiple sequential setState calls in one tick.
- Don't rename `nuqs` param keys after URL-state has been adopted by users; keep the schema stable.
- Never `aria-live` on row containers; the debounced summary region is the only one.
```

---

## Plan 05 — Detail Drawer + CSV Export

```
Execute `plans/billing-transactions-redesign/05-detail-drawer-export.md` top to bottom. Plans 01–04 must be committed.

Order of operations:
1. TDD `lib/billing/transactions/export-csv.ts` — RFC 4180 escape rules, toCsvRow, toCsv, CSV_COLUMNS order. One commit per green.
2. Build `use-copy-to-clipboard.ts` — writeText with "copied!" feedback (1.5s timeout), graceful failure.
3. Build `drawer-stripe-section.tsx` with copy buttons + Stripe-dashboard ExternalLink + receipt download (only when invoiceId).
4. Build `drawer-linked-entities.tsx` — cards linking to /extraction/{jobId}, /extraction/paper/{paperId}, /extraction/result/{resultId}. VERIFY the paper/result routes exist via an Explore agent before implementing; render disabled "coming soon" cards if they don't.
5. Build `drawer-metadata-table.tsx` — collapsible KV, data-metadata-key.
6. Build `transaction-detail-drawer.tsx` using shadcn Sheet side="right", width `min(480px, 92vw)`. Compose all sections.
7. Build `transactions-export-menu.tsx` with DropdownMenu: "Current view" (uses in-memory rows) + "All" (calls `fetchAll` which drains Convex pagination at numItems: 500).
8. Update `transactions-panel-client.tsx`: dynamic-import the drawer via `next/dynamic({ ssr: false })`, add `detailRow` local state, wire `onClick={setDetailRow}` on each row, define `fetchAll` via `useConvex`, replace the header's stub export button with `<TransactionsExportMenu>` via a slot prop on the header.
9. Add all drawer + export i18n keys.
10. Write RTL tests: drawer renders sections, close behavior, copy-to-clipboard fires, export menu happy path.
11. Verify via `next build --analyze` that the drawer chunk is separate (≥ 20 KB savings from first load).

Delegation rules:
- BEFORE step 4: spawn one Explore agent — "grep `app/` for routes matching `/extraction/paper/[id]` and `/extraction/result/[id]`; report whether these pages exist or if paper/result is nested under job". Adapt links accordingly.
- BEFORE step 3: spawn one Explore agent — "grep `convex/` for the Stripe webhook handler; report whether `hosted_invoice_url` is written to transaction metadata. If not, plan 05 should flag this as a follow-up; fall back to the admin dashboard URL with a PR-description note."
- Mobile Safari clipboard quirk: `navigator.clipboard.writeText` requires a user gesture. Since we call from a click handler, fine; do NOT call from a setTimeout-delayed chain.

Acceptance criteria:
- Row click opens drawer, Escape closes, focus returns to row (via explicit `.focus()` — see plan §Known pitfalls).
- Drawer shows amount, badges, linked entities (if present), Stripe section (if hasStripe), metadata (if non-empty).
- Copy buttons show a Check icon for 1.5s after success.
- CSV export: "Current view" downloads filtered rows; "All" drains all pages with a Loader2 spinner.
- CSVs are RFC-4180 valid (parseable by papaparse, Excel, Google Sheets).
- Drawer chunk separate from initial bundle.
- Axe clean on drawer open with representative content.

Commit discipline: TDD commits first for export-csv, then one commit per drawer section, drawer composition, export menu, client integration, i18n. Prefix: `feat(billing-txn): [plan-05] <what>`.

Non-negotiable:
- Dynamic import the drawer — no direct import in the client island.
- RFC 4180 compliance — test with papaparse round-trip.
- Never include BOM by default (Excel-compat toggle deferred).
- If hosted_invoice_url isn't captured in metadata, document the admin-URL limitation in the PR.
```

---

## Plan 06 — Keyboard, States, A11y, E2E, Perf Benchmarks

```
Execute `plans/billing-transactions-redesign/06-polish-a11y-tests.md` top to bottom. Plans 01–05 must be committed.

Order of operations:
1. Build `use-transactions-keyboard.ts` per plan §1. Global keydown listener with input/textarea guard. Keyboard contract: `/`, `ArrowUp/Down`, `Enter`, `Esc`, `Cmd+E` (Mac) / `Ctrl+E` (non-Mac).
2. Wire keyboard hook into `transactions-panel-client.tsx`: listRef, searchRef, pass activeId into rows via isActive prop.
3. Build `transactions-error-banner.tsx` — role="alert", inline retriable banner.
4. Build `transactions-empty-state.tsx` — no-data variant with "Buy credits" CTA, no-matches variant with "Clear filters" button.
5. Build (or finalize) `transactions-list-skeleton.tsx` — 6 rows matching comfortable density.
6. Audit reduced-motion: add `@media (prefers-reduced-motion: reduce)` overrides to `app/globals.css` for `[data-transactions-progress]` transition and `.txn-pulse`.
7. Add top-of-file JSDoc in `transactions-panel-client.tsx` documenting the full `data-*` contract + keyboard shortcuts.
8. Write `tests/perf/billing-transactions.bench.ts` with bench cases at 500 and 1000 rows (toViewModel, filter, partition, toCsv). Create `tests/perf/fixtures/transactions.ts` with a seeded PRNG fixture.
9. Add `bench:transactions` script to package.json. Commit baselines to `tests/perf/BASELINES.md`.
10. Write `e2e/billing/transactions.spec.ts` covering URL-roundtrip, row click → drawer, CSV export, keyboard nav, filter + clear, empty state, reduced motion.
11. Write `e2e/billing/transactions.axe.spec.ts` iterating density × filter × drawer-state combinations (24 total), asserting zero violations per combination.
12. RTL tests: use-transactions-keyboard, transactions-error-banner, transactions-empty-state; extend transactions-panel-client.test.tsx with keyboard + error + empty branches.
13. Remove any dead code from plans 02–05 (inline empty states, stubs). Final grep-and-clean.

Delegation rules:
- BEFORE step 3: spawn one Explore agent to read `lib/auth/use-auth-query.ts:117` and report the error surface of `useProtectedPaginatedQuery`. If no `status: "error"` variant exists, wrap the query call in try/catch at the client island and expose error state via a ref.
- BEFORE step 7: spawn one Explore agent to find all files that consume any `data-txn-*` or `data-transactions-*` attribute (tests + E2E). Update the JSDoc contract if any attribute was added/renamed during plans 02–05.
- Perf bench thresholds are guidance, not CI gates. If numbers exceed targets by 2×, profile before optimizing (React Compiler may already be doing the right thing).

Acceptance criteria:
- Keyboard: `/`, ↑/↓, Enter, Esc, Cmd+E behave per plan contract.
- `aria-activedescendant` on the list; `data-txn-active` on the active row.
- Error banner renders on query failure with retriable Retry button.
- Empty states: no-data and no-matches variants both correct.
- Skeleton shown during first-page load.
- `prefers-reduced-motion` disables progress bar transition, pulse animation, honors system preference for drawer/popover.
- E2E matrix passes (local + CI).
- Axe matrix passes (24 combinations).
- Perf bench targets met; baselines committed.
- Top-of-file JSDoc documents full data-* contract.
- No dead code; no stubs.

Commit discipline: one commit per new component/hook, one for reduced-motion audit, one for E2E, one for axe matrix, one for perf bench + fixtures + baselines, one for JSDoc. Prefix: `feat(billing-txn): [plan-06] <what>`.

Non-negotiable:
- Never `aria-live` on the list itself.
- `activeId` must reset when rows change (filter/sort/pagination).
- Global keydown listener must NOT intercept keys while the user is typing in an input.
- Document the data-* contract; never ship a test that asserts on a class.

After plan 06: the redesign is production-ready. Update `plans/billing-transactions-redesign/00-README.md` with a short "Shipped" note at the bottom if the project convention calls for it.
```

---

## Resumption cheatsheet

If a session crashes or grows stale mid-plan, here's how to resume without re-reading the entire conversation:

1. `git log --oneline dev | head -10` — what's landed?
2. `cat plans/billing-transactions-redesign/<current-plan>.md | head -100` — re-orient.
3. Paste the current plan's prompt from this file.
4. The agent will pick up at the first unchecked acceptance criterion.

Plans are resumable because:
- TDD commits are per-test-case (atomic, revertable).
- UI commits are per-component (atomic).
- Acceptance criteria are checklists, not free-form.
- `data-*` contracts don't change mid-plan — they're the testing API.
