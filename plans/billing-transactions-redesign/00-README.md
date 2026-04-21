# Billing Transactions — Redesign Plan Set

Six-plan redesign of the billing page's **Transactions** section so it matches the visual depth, interactivity, and performance of the extraction-chat **Sources panel** (the project's reference surface for rich list UX). Today the list is a flat `<ul>` of ~50 rows with one-line description + muted timestamp + red/green amount — functional, but flat, iconless, unfilterable beyond a single `?jobId=` URL param, and without tests. This plan set replaces it with a tinted-icon ledger with typed filters, saved views, date grouping, row detail drawer, Stripe-linked receipts, full keyboard + a11y, and Convex-paginated loading — sliced so each plan ships (and reverts) independently.

Primary reference surface: `components/extraction/chat/sources-panel/*`.
Primary donor of patterns: `sources-panel-list.tsx`, `sources-panel-toolbar.tsx`, `source-row.tsx`, `use-sources-panel-keyboard.ts`, `lib/chat/source-presentation.ts`.

---

## Motivation

Empirical state of the transactions section as of this plan set (verified against source, not speculation):

1. **Flat row hierarchy.** `components/billing/transactions-list.tsx:100-149` renders each row as `<li class="flex items-center justify-between …">` with a truncated description + single muted timestamp on the left and a right-aligned signed amount. No icon, no status pill, no credit-pool affordance, no running balance, no expansion. The entire "visual hierarchy" is a red/green color swap on the amount plus a `variant="outline"` badge carrying the billing-type label.
2. **The query surfaces 7 fields; the UI consumes 3.** `creditTransactionValidator` (`convex/lib/validators.ts:105-133`) carries 17 fields on a transaction. The component ignores `balanceAfter`, `creditType` (free / paid), `paperId`, `resultId`, `metadata`, `stripeInvoiceId`, `stripePaymentIntentId`, `stripeChargeId`, `stripeCheckoutSessionId`. These are the raw materials for a drawer with copy-to-clipboard IDs, receipt downloads, and linked-entity cards — all shipped by Stripe / Mercury / Linear billing pages as baseline.
3. **No filters, no search, no sort, no pagination.** The sole filter is the `?jobId=` URL param (set externally when a user opens billing from a job detail). The query is capped at 50 rows without `jobId` or 200 with (`convex/credits/queries.ts:84,92`). A user with > 50 lifetime transactions sees neither older history nor any way to slice the present.
4. **No tests.** Grep finds zero `.test.tsx` touching `TransactionsList`. E2E specs exist for other billing primitives but do not exercise the transactions list. This is the single largest regression risk when we rewrite.
5. **No error state.** `useProtectedQuery` exposes a `settlement` status but the component only branches on `!== "ready"` (treated as loading) vs `rows.length === 0` (treated as empty). A failed query silently renders "No transactions yet."
6. **No mobile adaptation.** There is no responsive treatment — the row layout and typography are the same at 360px viewport and 1440px.
7. **No accessibility beyond the shell.** The `<section role="region">` landmark and `aria-label` on the clear-filter button are correct, but the list itself has no keyboard nav, no `role="list"` decoration, no hover affordance, no focus ring on rows.

Meanwhile the **sources panel** ships: tinted-icon-per-source with CSS-var color, left-border accent for selection state, animated checkbox pop, opacity-graded hierarchy, virtualized list with `@tanstack/react-virtual`, WAI-ARIA APG listbox keyboard pattern, `useDeferredValue` search with `data-search-deferred` flag, source filter with counts, sort menu with direction toggle, bulk action cluster, extension banner with `motion.div`, comprehensive `data-*` attributes in lieu of class-based tests. That's the bar we're raising billing transactions to.

Current per-row schema fields, typed (ready for presentation layer):

```ts
type: "purchase" | "usage" | "grant" | "refund" | "expiry";
creditType: "free" | "paid";
billingType: "extraction_llm" | "embedding" | "screening" | "chat" | null;
amount: number;              // signed — negative = out, positive = in
balanceAfter: number;
description: string | null;
jobId: Id<"extractionJobs"> | null;
paperId: Id<"extractionPapers"> | null;
resultId: Id<"extractionResults"> | null;
stripeInvoiceId: string | null;
stripePaymentIntentId: string | null;
stripeChargeId: string | null;
stripeCheckoutSessionId: string | null;
metadata: Record<string, string>;
createdAt: number;
```

Every field in that list is a row-detail or filter dimension that the redesign surfaces.

---

## Design decisions (locked via research, 2026-04-20)

| # | Decision | Source |
|---|---|---|
| **D1** | **Mirror the sources-panel file layout.** New components live under `components/billing/transactions/` with the same shape: `transactions-panel.tsx` (shell), `transactions-panel-client.tsx` (island), `transactions-panel-header.tsx`, `transactions-panel-toolbar.tsx`, `transactions-panel-tabs.tsx`, `transactions-panel-list.tsx`, `transactions-group-header.tsx`, `transaction-row.tsx`, `transaction-detail-drawer.tsx`. Pure logic lives in `lib/billing/transactions/`. | Research — sources-panel is the project's reference for rich list UX. |
| **D2** | **Pure presentation + formatting + grouping + filtering helpers, TDD-first.** `lib/billing/transactions/presentation.ts` (type → icon/tint/label), `formatters.ts` (amount/balance/relative time), `grouping.ts` (date-bucket classification), `filters.ts` (predicate builder). Components consume these; the class mappings, icon choices, and bucket boundaries are unit-tested in `lib/**.test.ts`. No CSS-class assertions in any tests. | Project `CLAUDE.md` — "push pure logic out of the render tree and unit-test it directly". |
| **D3** | **Tinted 32px icon tile per transaction type.** Glyph from `lucide-react`, color via CSS var (`--chart-1..5`), background is the same var at ~12% alpha. `purchase` → `CreditCard` on `--chart-2` (blue), `grant` → `Gift` on `--chart-3` (green), `refund` → `Undo2` on `--chart-1` (amber), `usage` → `Zap` on `--muted-foreground` (neutral), `expiry` → `Hourglass` on `--destructive`. `usage` rows carry a **secondary** sub-icon bottom-right indicating billing type (`Sparkles`/`Network`/`ListChecks`/`MessageSquare`). | Research — Stripe/Mercury/Ramp tinted-square icon convention; project CSS-var palette exists in `app/globals.css:69-73`. |
| **D4** | **Left-border accent stripe only for exceptional states.** 2px `border-l-destructive` for failed/expired rows; 2px `border-l-chart-1` for disputes (future). **Never** on routine rows — painting a stripe on every row destroys the signal (Stripe/Ramp hybrid rule). | Research — "Reserve strong treatment for exceptional states." |
| **D5** | **Money-in = emerald; money-out = neutral foreground; red = strictly for failed/expired.** Most products get this wrong — painting every debit red trains users to ignore it. We reserve `text-destructive` for failure states and use default foreground weight for routine debits, with a leading `−`. `+` prefix on credits. | Research across Stripe / Mercury / Ramp. |
| **D6** | **`tabular-nums` on every amount cell and every count in the summary gauge.** Applied via Tailwind utility. Non-negotiable for right-aligned columns. | Research — without it the right-aligned column visibly wobbles on re-render. |
| **D7** | **Paginated query via `useProtectedPaginatedQuery`.** `lib/auth/use-auth-query.ts:117` already exports the wrapper around Convex's `usePaginatedQuery`. Extend `convex/credits/queries.ts:getTransactions` to accept `paginationOptsValidator` + typed filter args and return `PaginationResult<CreditTransaction>`. Start with `initialNumItems: 25`, Load More via IntersectionObserver on the last row. Tolerate page-size drift per Convex's pin-endpoints model. | Code inventory — paginated wrapper already exists; `getTransactions` is called from exactly one external site (`components/billing/transactions-list.tsx:37`). |
| **D8** | **No virtualization for MVP.** At typical 50–1,000 rows, use `content-visibility: auto; contain-intrinsic-size: 0 60px` per row — near-free 3–7× first-paint win, rows stay in the a11y tree and DOM (find-in-page works). Virtualize only if a future "export preview" ever renders > 2,000 rows at once. | Research — virtualization threshold is 200–5k ambiguous; below that, `content-visibility` is sufficient and avoids complexity. |
| **D9** | **URL state via `nuqs`.** Already a project dep (`package.json:63`). All filter / sort / search / density / active-view params roundtrip via `useQueryState`. Server Component reads `searchParams` prop to render the first frame without hydration flash. Filter URLs are shareable (Stripe-original pattern). | Code inventory — `nuqs@^2.6.0` installed; `components/extraction/source-selector.tsx` already uses it. |
| **D10** | **Group by date bucket with sticky subheaders; collapse grouping when sort ≠ date.** `Today / Yesterday / This week / Last week / [Month YYYY]`. If user sorts by amount or type, grouping collapses to a flat list (grouped-sorted lists lie). Headers use `position: sticky; top: 0` inside the scroll container with `bg-background/95 backdrop-blur`. | Research — Ramp's rule; grouping and sort are mutually exclusive modes. |
| **D11** | **Saved "Data Views" as first-class tabs.** `All / Purchases / Usage / Refunds & grants / Failed`. Each tab is a named preset — shorthand for a URL param combination. User-defined saved views are **out of scope for MVP**, deferred as a future enhancement. | Research — Mercury's Data Views, Shopify's Views, Linear's custom filters. |
| **D12** | **Row click → right-side shadcn `Sheet` drawer.** Dynamic-imported via `next/dynamic` with `ssr: false`. Drawer surfaces full description, copyable IDs, Stripe dashboard links, receipt PDF download (when `stripeInvoiceId` present), linked `jobId`/`paperId`/`resultId` cards, collapsible `metadata` KV table, credit-pool badge, running balance. | Research — Mercury / Linear / Ramp navigate-in-place convention; perf research — dynamic import for secondary UI keeps initial chunk small. |
| **D13** | **Single `role="status" aria-live="polite"` region** near the filter bar, debounced, announces "Showing N of M transactions" when filters settle. **Never** `aria-live` on the list itself (screen-reader spam). `aria-busy="true"` on the list container during filter transitions. | WAI-ARIA authoring practices; sources-panel precedent. |
| **D14** | **Keyboard contract:** `/` focuses search, `↑/↓` move focus between rows via roving tabindex + `aria-activedescendant`, `Enter` opens drawer, `Esc` closes drawer then clears search then blurs, `Cmd+E` opens export menu. Mirrors `use-sources-panel-keyboard.ts` shape — same APG listbox pattern minus the multi-select range. | WAI-ARIA APG; sources-panel precedent. |
| **D15** | **`useDeferredValue` on the search query** before it enters the filter pipeline; `data-search-deferred="true"` attribute exposes stale state to tests. Eager input value for zero-lag typing; deferred pipeline for the filter. | Sources-panel precedent (`use-sources-panel-state.ts:70-71`); React 19 canonical pattern. |
| **D16** | **Density toggle** — compact / comfortable / spacious, persisted to `localStorage`. Default: comfortable (60px row). Compact drops the secondary metadata line and sets `white-space: nowrap`. Spacious adds a third line with running balance. Applied via `data-density` on the list container; CSS keys off the attribute. | Research — Material React Table / Carbon density pattern. |
| **D17** | **Export: CSV only for MVP.** `Export current view` (what filters produce) and `Export all` (full date range). PDF receipts download directly via Stripe's hosted invoice URL, no server proxy. | Research — Stripe exposes hosted invoice URLs; CSV handles the 95% case. |
| **D18** | **Icons: named imports from `lucide-react`; add `optimizePackageImports: ['lucide-react']`** to `next.config.ts` — currently missing. Vercel's benchmarks show ~28% build-time improvement + 100-300KB bundle savings from this flag alone. | Code inventory — `next.config.ts` does not currently include the flag; research — Vercel official guidance. |
| **D19** | **React 19 Compiler handles most memoization.** Manual `React.memo` only on `TransactionRow` (hot path on Convex realtime updates) with a custom equality on `(prev.row === next.row && prev.density === next.density && prev.isActive === next.isActive)`. No `'use no memo'` pragma needed — we are not using `useVirtualizer`. | Research — React Compiler stable, manual memo reserved for three concrete cases (virtualizer props, non-compiled libs, hot paths). |
| **D20** | **Testing: behavior only, per project `CLAUDE.md`.** Pure logic (`presentation.ts`, `formatters.ts`, `grouping.ts`, `filters.ts`, `export-csv.ts`) unit-tested in `lib/billing/transactions/**.test.ts`. Component tests assert via `data-type`, `data-direction`, `data-credit-type`, `data-billing-type`, `data-status`, `data-density`, `data-search-deferred`, and ARIA roles/states. No CSS-class assertions. Pure logic TDD before any wiring. | Project `CLAUDE.md` testing philosophy. |

---

## Plan files

```
plans/billing-transactions-redesign/
├── 00-README.md                        (this file)
├── 01-data-foundation.md               (pure logic + paginated query + filter args)
├── 02-row-redesign.md                  (TransactionRow + Icon + Amount + StatusPill)
├── 03-header-grouping-pagination.md    (summary gauge + date groups + Load More)
├── 04-toolbar-filters-views.md         (toolbar + tabs + nuqs URL state)
├── 05-detail-drawer-export.md          (Sheet drawer + Stripe links + CSV export)
├── 06-polish-a11y-tests.md             (keyboard + skeletons + error states + axe + E2E)
└── PROMPTS.md                          (one copy-paste execution prompt per plan)
```

## Dependency graph

```
01 data-foundation ──► 02 row-redesign ──► 03 header-grouping ──► 04 toolbar-filters ──► 05 drawer-export ──► 06 polish-a11y
                          │                                          │                       │
                          └──────── (02 unblocks 04's row-level data attrs for tests) ───────┘
```

Ship order recommendation: **01 → 02 → 03 → 04 → 05 → 06**. No sensible parallelization: 02 needs 01's helpers, 03 needs 02's rows, 04 needs 03's paginated state, 05 reads URL state from 04, 06 polishes the complete surface.

---

## Reuse (DRY)

These plans lean on primitives the codebase already ships. Primary donors:

- **`components/extraction/chat/sources-panel/*`** — the reference surface. Row chrome, toolbar shape, header gauge pattern, keyboard hook, `data-*` conventions, deferred-search pattern, reduced-motion handling. Plans 02–06 clone structure without dragging specifics (no multi-select, no virtualization, no inclusion semantics).
- **`lib/chat/source-presentation.ts`** — precedent for `Record<Key, CssVarName>` color-mapping. Plan 01's `lib/billing/transactions/presentation.ts` follows the same shape.
- **`lib/auth/use-auth-query.ts:117`** — `useProtectedPaginatedQuery` already wraps `usePaginatedQuery` + auth gating. Plan 03 consumes it. No new auth wrappers.
- **`nuqs` (installed)** — `components/extraction/source-selector.tsx` demonstrates URL-state patterns in this codebase. Plan 04 follows the same pattern.
- **`lib/auth/use-auth-query.ts`** — `useProtectedQuery` is already what the current component uses; we only swap the hook to the paginated variant.
- **shadcn `Sheet`** — plan 05's detail drawer reuses the same component the sources panel mobile sheet uses (`components/ui/sheet.tsx`).
- **shadcn `Tabs`, `DropdownMenu`, `Popover`, `Input`, `Button`, `Badge`, `Skeleton`** — all already in `components/ui/`. No new primitive installs.
- **`next-intl` `useTranslations` + `useFormatter`** — current component already uses them; plans add new message keys under `billingPage.transactions.*`.
- **`useReducedMotion()` from `motion/react`** — house pattern (used in 18+ components). Plan 02 uses it for the pending-pill pulse and any future row-level motion.
- **`@convex-dev/migrations`** — not needed; plan 01's query change is a widening (new optional args). Callers pass the same args they pass today.

No new deps. No new skill installs. The redesign is composed entirely from primitives the project already ships.

---

## Testing doctrine

All plans follow the project's testing philosophy (project `CLAUDE.md`):

- **Assert on behavior, ARIA roles, `data-*` attributes, and semantic state — not CSS classes.**
- Expose internal contracts via `data-type`, `data-direction`, `data-credit-type`, `data-billing-type`, `data-status`, `data-density`, `data-search-deferred`, `role="status"`, `role="list"`/`role="listitem"`, `aria-activedescendant`, `aria-busy`, `aria-sort`.
- Pure logic (presentation/formatters/grouping/filters/export-csv) is tested in `lib/billing/transactions/**.test.ts`.
- Component tests via React Testing Library; prefer `getByRole`, `getByText`, `getByLabelText`.

### TDD policy — **pure logic only**

Each plan carries an explicit TDD sequence for its pure-logic modules. Modules are fully green before any Convex wiring or UI work begins. Commit after each green.

- **Plan 01** — `presentation.ts`, `formatters.ts`, `grouping.ts`, `filters.ts`, `transaction-view-model.ts`.
- **Plan 02** — none (test-after for UI).
- **Plan 03** — none (grouping already green from plan 01).
- **Plan 04** — none (nuqs schema tested via integration).
- **Plan 05** — `export-csv.ts` (CSV escape + column schema).
- **Plan 06** — none.

Convex query change (plan 01), React components (plans 02–06), URL-state wiring (plan 04), and drawer/export wiring (plan 05) are **test-after**. The Test plan section in each plan enumerates the behavior assertions, written after green-lit implementation.

---

## Migration stance — **none**

No schema changes. Plan 01 extends `api.credits.queries.getTransactions` with **additive optional arguments**: existing call sites that pass `{ limit: 50 }` or `{ jobId, limit: 200 }` continue to work unchanged. The return type widens from `CreditTransaction[]` to `PaginationResult<CreditTransaction>` — but there is exactly one external caller (`components/billing/transactions-list.tsx:37`), which this plan set rewrites wholesale. No backfill. No migration script. Dev data is disposable per the existing project doctrine (`plans/extraction-recovery/00-README.md` § Migration stance).

---

## Delegation policy — protect the main session's context

Context rot is the silent enemy of long-running plans. Every file read, grep, and tool output pollutes the main session's context. Subagents absorb that pollution and return synthesized summaries.

**The executing session MUST delegate broadly** via the Agent tool. Rule of thumb: any investigation needing more than ~3 file reads or ~3 greps → spawn a subagent.

### Agent types to prefer

- **`Explore`** — fast codebase exploration. Use for "where is X defined?", "map all callers of Y", "find every file that imports Z". Always specify thoroughness.
- **`general-purpose`** — multi-step research, web doc reading, skill discovery, cross-library synthesis.
- **`Plan`** — subsidiary planning for a non-trivial sub-problem.

### What to delegate (high value, for this plan set specifically)

- "Grep every caller of `api.credits.queries.getTransactions` across the repo; confirm plan 01's assumption that only `components/billing/transactions-list.tsx:37` consumes it."
- "Read the `nuqs` README section on `useQueryStates` + `createSearchParamsCache`; show the server-side parsing pattern we need for the filter bar's first frame."
- "Read `components/extraction/chat/sources-panel/use-sources-panel-keyboard.ts` end-to-end; return the listbox keyboard contract as a bulleted spec so plan 06 can clone it minus the multi-select range."
- "Read the Convex `usePaginatedQuery` docs + `stack.convex.dev/fully-reactive-pagination` and return the pin-endpoints model in 200 words; plan 03 needs to tolerate page-size drift in its UI."
- "Find every lucide-react import in the codebase to verify tree-shaking assumption; confirm plan 02's `optimizePackageImports` addition is the right call."

### What to keep in the main session

- The TDD red → green → refactor cycle for pure-logic modules.
- Commits. Main session owns discipline.
- Plan-file edits (deviations, updates).
- Final acceptance-criteria verification per plan.
- Trivial one-shot lookups (faster to grep directly than spawn an agent).

### Parallelism

When spawning multiple subagents for independent questions, put them in a **single message with multiple Agent tool calls** so the harness runs them concurrently.

### When the session grows stale

If the main session accumulates many tool calls and you feel quality drifting, **pause, commit progress, write a one-paragraph state summary into the plan file or commit message, then restart in a fresh `/clear`'d session** by pasting the plan's prompt from `PROMPTS.md`. Plan files are designed to be resumable from any acceptance-criteria checkpoint.

---

## Convex patterns referenced across plans

- **`useProtectedPaginatedQuery`** (`lib/auth/use-auth-query.ts:117`) — project wrapper around `usePaginatedQuery` with auth gating. Plan 03 consumes it; no new wrapper.
- **`paginationOptsValidator`** (Convex built-in) — plan 01 extends `getTransactions`'s `args` object with `paginationOpts: v.optional(paginationOptsValidator)` and returns `PaginationResult<T>` when present, `T[]` when absent (backwards-compat with existing unscoped call path for safety — removed once plan 03 lands).
- **`by_job` index** — existing, used today. No change.
- **`by_type_date` composite index** — schema already ships it (`convex/schema.ts:125-170` per audit); plan 01 starts using it for typed filter queries.
- **`by_credits` index** — existing, primary unfiltered path.
- **No aggregate, no `@convex-dev/aggregate`** — per-user lifetime ledgers cap at low thousands; pagination + index is sufficient.
- **No optimistic updates** needed — transactions are read-only from the user's perspective (purchases happen via Stripe webhook; usage is server-written). The redesign adds zero write paths.

---

## Sources

- **Current code audit** — `components/billing/transactions-list.tsx:26-153`, `convex/credits/queries.ts:54-96`, `convex/schema.ts:125-170`, `convex/lib/validators.ts:105-133`.
- **Design reference** — `components/extraction/chat/sources-panel/*`, `lib/chat/source-presentation.ts`, `lib/chat/source-chips.ts`, `lib/chat/search/source-scorer.ts`, `components/extraction/chat/sources-panel/use-sources-panel-keyboard.ts`.
- **Industry patterns** (research-agent-synthesized) — Stripe Dashboard (payments + balance transactions), Mercury Transactions page + Data Views, Linear billing, Vercel Usage + Invoices, OpenAI platform usage, Anthropic Console, Ramp (grouping + collapse-on-sort rule), Shopify admin (autocomplete filter tokens + saved views).
- **Performance references** (research-agent-synthesized) — Next.js App Router `optimizePackageImports`, React 19 Compiler + `useDeferredValue` + `useTransition`, Convex `usePaginatedQuery` pinned cursors, CSS `content-visibility: auto`, `aria-live="polite"` + `aria-busy`, INP < 200ms target.
- **Project code inventory** — `nuqs@^2.6.0` installed; `useProtectedPaginatedQuery` exists; CSS vars `--chart-1..5` defined in `app/globals.css:69-73`; `next-intl` already used for formatting in the current component.
- **Project conventions** — `CLAUDE.md` (testing philosophy, behavioral assertions), `convex/_generated/ai/guidelines.md` (Convex patterns).

---

## Shipped — 2026-04-20

All six plans landed on `dev`. Production-ready surface as of plan 06.

| Plan | Status | Headlines |
|---|---|---|
| 01 — Data foundation | ✅ | Pure-logic libs (view-model, presentation, formatters, filters, grouping, sort), TDD-first. |
| 02 — Row redesign | ✅ | `TransactionRow` + amount / icon / status-pill primitives, density variants, `data-txn-*` contract. |
| 03 — Header + grouping + pagination | ✅ | Summary header, sticky group buckets, IO-driven `loadMore`, RSC shell + client island. |
| 04 — Toolbar + filters + views | ✅ | nuqs-backed `useTransactionsState`, multi-select facets, date-range presets, sort/density/tabs. |
| 05 — Detail drawer + export | ✅ | Dynamic-imported `Sheet` drawer, Stripe / linked / metadata sections, RFC-4180 CSV export. |
| 06 — Polish + a11y + tests | ✅ | `aria-activedescendant` keyboard nav, error boundary + retry banner, two empty-state variants, reduced-motion audit, perf bench (with grouping fix), 24-combo axe matrix, E2E specs, full data-* JSDoc contract. |

**Acceptance — plan 06:**
- Keyboard `/`, `↑/↓`, `Enter`, `Esc`, `Cmd/Ctrl+E` work per contract; `aria-activedescendant` + `data-txn-active` flip; rows reset on filter.
- `<TransactionsErrorBoundary>` catches Convex query throws → inline `<TransactionsErrorBanner>` with Retry that remounts the subtree.
- `<TransactionsEmptyState>` ships `no-data` (Buy credits CTA) and `no-matches` (Clear filters CTA) variants.
- Skeleton renders during first-page load; `prefers-reduced-motion` strips progress transition + skeleton pulse.
- 164 unit + a11y tests green; bench targets met (`partition by group` 35ms → 1.8ms after `Intl.DateTimeFormat` cache).
- `e2e/billing/specs/transactions.spec.ts` + `transactions.axe.spec.ts` (24-combination matrix) wired into the existing billing project.
- `data-*` contract documented at the top of `transactions-panel-client.tsx`.

**Live smoke (deferred to human):** Run `npm run test:billing:e2e` once Stripe + Clerk e2e creds are loaded; confirm CSV export, keyboard nav, and reduced-motion paths against a real backend.
