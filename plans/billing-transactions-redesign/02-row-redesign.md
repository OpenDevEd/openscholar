# Plan 02 — Row Redesign: Icon, Amount, StatusPill, Typography

**Depends on:** 01 (pure logic + view-model). **Blocks:** 03, 04, 05, 06.

## Goal

Replace the flat single-line `<li>` render with a rich row composition: 32px tinted icon tile on the left, typography-graded description + metadata block in the middle, `tabular-nums` signed amount + conditional status pill on the right. Hover reveals action buttons (copy ID, open linked job). Left-border stripe appears only on failed/expired rows. No filters, no grouping, no drawer yet — same 50-row list, same `?jobId=` URL filter, same query hook. This is a **visual-only** refactor that leaves functional behavior identical.

Implements decisions **D1** (component tree), **D3** (tinted icon tile), **D4** (exceptional-state stripe), **D5** (money color roles), **D6** (tabular-nums), **D18** (optimizePackageImports), **D19** (React.memo scope).

## Scope

**In scope**

- New `components/billing/transactions/transaction-icon.tsx` — 32px rounded-lg tinted square + glyph + optional billing-type sub-icon.
- New `components/billing/transactions/transaction-amount.tsx` — right-aligned signed amount with tabular-nums, pool indicator, optional balance-after (spacious density only).
- New `components/billing/transactions/transaction-status-pill.tsx` — pending/failed/expired pill (conditional render; returns null for routine states).
- New `components/billing/transactions/transaction-row.tsx` — composition; memoized via `React.memo` with custom equality.
- Refactor `components/billing/transactions-list.tsx` to render `<TransactionRow row={…} />` instead of inline JSX; pipe `toViewModel` from plan 01.
- Add `lucide-react` to `next.config.ts`'s `experimental.optimizePackageImports`.
- i18n keys for every type + billing type label (`billingPage.transactions.type.*`, `.billingType.*`).
- Behavior tests for each new component via React Testing Library.

**Out of scope**

- Filters / search / sort / tabs (plan 04).
- Pagination / grouping / Load More (plan 03).
- Detail drawer (plan 05).
- Keyboard navigation between rows (plan 06).
- Mobile-specific layout (defer — responsive via flex utilities is sufficient at this stage).

## Design

### 1. `transaction-icon.tsx`

```tsx
"use client";

import { memo } from "react";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { BILLING_TYPE_ICON, presentationFor } from "@/lib/billing/transactions/presentation";
import { cn } from "@/lib/utils";

interface Props {
  type: TransactionViewModel["type"];
  billingType: TransactionViewModel["billingType"];
  className?: string;
}

function TransactionIconImpl({ type, billingType, className }: Props) {
  const { icon: Icon, colorVar } = presentationFor(type);
  const SubIcon = billingType ? BILLING_TYPE_ICON[billingType] : null;

  return (
    <div
      data-txn-icon
      data-txn-type={type}
      data-txn-billing-type={billingType ?? "none"}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-lg",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklch, var(${colorVar}) 12%, transparent)`,
        color: `var(${colorVar})`,
      }}
    >
      <Icon className="size-4" aria-hidden="true" />
      {SubIcon && (
        <span
          className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-background"
          aria-hidden="true"
        >
          <SubIcon className="size-2.5 text-muted-foreground" />
        </span>
      )}
    </div>
  );
}

export const TransactionIcon = memo(TransactionIconImpl);
```

Design notes:

- `color-mix(in oklch, var(--chart-X) 12%, transparent)` gives a modern, theme-aware tint. Falls back to `transparent` if the browser lacks support — acceptable progressive enhancement. If the theme system complains, use a Tailwind arbitrary-value class: `className={\`bg-[color-mix(in_oklch,var(${colorVar})_12%,transparent)]\`}` — but prefer the inline style to avoid Tailwind's JIT missing the dynamic value.
- `aria-hidden` on both glyph and sub-icon — the row's `aria-label` (set in `transaction-row.tsx`) carries the semantic meaning.
- `data-txn-type` + `data-txn-billing-type` are the test contracts.

### 2. `transaction-amount.tsx`

```tsx
"use client";

import { useFormatter } from "next-intl";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { cn } from "@/lib/utils";

interface Props {
  direction: TransactionViewModel["direction"];
  amount: TransactionViewModel["amount"];
  status: "routine" | "pending" | "failed" | "expired";
  density: "compact" | "comfortable" | "spacious";
  balanceAfter?: number;
}

export function TransactionAmount({ direction, amount, status, density, balanceAfter }: Props) {
  const format = useFormatter();
  const sign = direction === "in" ? "+" : "\u2212";  // U+2212 MINUS SIGN

  return (
    <div
      data-txn-amount
      data-txn-direction={direction}
      data-txn-status={status}
      className="flex shrink-0 flex-col items-end gap-0.5"
    >
      <span
        className={cn(
          "tabular-nums text-sm font-semibold",
          direction === "in" && status === "routine" && "text-emerald-600 dark:text-emerald-500",
          status === "failed" || status === "expired" ? "text-destructive" : null,
          // routine outgoing: default foreground (per D5 — not red)
        )}
      >
        {sign}{format.number(amount)}
      </span>
      {density === "spacious" && balanceAfter !== undefined && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 tabular-nums">
          bal&nbsp;{format.number(balanceAfter)}
        </span>
      )}
    </div>
  );
}
```

### 3. `transaction-status-pill.tsx`

```tsx
"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface Props {
  status: "pending" | "failed" | "expired";
}

export function TransactionStatusPill({ status }: Props) {
  const t = useTranslations("billingPage.transactions.status");
  return (
    <span
      data-txn-status-pill={status}
      role="status"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        status === "pending" && "bg-primary/10 text-primary txn-pulse",
        status === "failed"  && "bg-destructive/10 text-destructive",
        status === "expired" && "bg-muted text-muted-foreground",
      )}
    >
      {t(status)}
    </span>
  );
}
```

Plus global CSS (append to `app/globals.css`):

```css
.txn-pulse {
  animation: txn-pulse 1.6s ease-in-out infinite;
}
@keyframes txn-pulse {
  0%, 100% { opacity: 0.7; }
  50%      { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .txn-pulse { animation: none; }
}
```

Routine-state rows do not render a pill at all — `TransactionRow` branches on `status === "routine"` and passes through only when one of the three exceptional states applies.

### 4. `transaction-row.tsx` — composition

```tsx
"use client";

import { memo, useCallback } from "react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowUpRight, Copy } from "lucide-react";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { TransactionIcon } from "./transaction-icon";
import { TransactionAmount } from "./transaction-amount";
import { TransactionStatusPill } from "./transaction-status-pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TransactionRowProps {
  row: TransactionViewModel;
  density: "compact" | "comfortable" | "spacious";
  isActive?: boolean;                           // aria-activedescendant target (plan 06)
  onClick?: (row: TransactionViewModel) => void; // row click → drawer (plan 05)
}

function TransactionRowImpl({ row, density, isActive = false, onClick }: TransactionRowProps) {
  const t = useTranslations("billingPage.transactions");
  const tType = useTranslations("billingPage.transactions.type");
  const tBilling = useTranslations("extraction.cost.breakdown");
  const format = useFormatter();

  const status = resolveStatus(row); // "routine" | "pending" | "failed" | "expired"
  const title = row.description ?? tType(row.type);
  const secondary = buildSecondaryLine(row, format, tBilling);

  const handleClick = useCallback(() => onClick?.(row), [onClick, row]);

  return (
    <div
      role="listitem"
      id={`txn-row-${row.id}`}
      data-txn-row
      data-txn-id={row.id}
      data-txn-type={row.type}
      data-txn-direction={row.direction}
      data-txn-credit-type={row.creditType}
      data-txn-billing-type={row.billingType ?? "none"}
      data-txn-status={status}
      data-txn-density={density}
      data-txn-active={isActive || undefined}
      onClick={handleClick}
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 border-l-2 px-3 transition-colors",
        density === "compact"     && "py-2",
        density === "comfortable" && "py-2.5",
        density === "spacious"    && "py-3",
        // Exceptional-state border; D4
        status === "failed"  && "border-l-destructive",
        status === "expired" && "border-l-muted-foreground/40",
        status === "routine" && "border-l-transparent",
        status === "pending" && "border-l-primary/60",
        // Row hover
        "hover:bg-muted/40",
        // Active-descendant ring (plan 06)
        isActive && "bg-muted/60 ring-1 ring-ring ring-inset",
        // Content-visibility: plan 03 applies on the list scope, not per row. Skip here.
      )}
      aria-label={buildAriaLabel(row, format)}
    >
      <TransactionIcon type={row.type} billingType={row.billingType} />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="line-clamp-1 text-[13px] font-semibold leading-snug text-foreground">
          {title}
        </p>
        {density !== "compact" && (
          <p className="truncate text-[11px] text-muted-foreground">{secondary}</p>
        )}
      </div>

      {status !== "routine" && <TransactionStatusPill status={status} />}

      <TransactionAmount
        direction={row.direction}
        amount={row.amount}
        status={status}
        density={density}
        balanceAfter={row.balanceAfter}
      />

      {/* Hover-reveal action cluster — plan 05 wires the drawer; stubs for now */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {row.jobId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            aria-label={t("actions.openJob")}
            asChild
            onClick={(e) => e.stopPropagation()}
          >
            <Link href={`/extraction/${row.jobId}`}>
              <ArrowUpRight className="size-3" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export const TransactionRow = memo(
  TransactionRowImpl,
  (prev, next) =>
    prev.row === next.row &&
    prev.density === next.density &&
    prev.isActive === next.isActive &&
    prev.onClick === next.onClick,
);
```

- `role="listitem"` on the row; the parent list will carry `role="list"` (plan 03).
- Every behavioral dimension exposed as `data-*` — tests assert on these, never on CSS classes.
- `onClick` prop is optional; plan 02 ships with it unwired (no drawer yet). Plan 05 passes a handler.
- Memoization via `React.memo` (D19). The React Compiler can handle the outer component; the manual memo protects the row identity against realtime Convex re-renders that would otherwise re-build row objects. Plan 01's `toViewModel` should be called inside a `useMemo` in the parent (see § 5 below) so `row` references are stable across re-renders.

Helpers (colocated in the same file):

```tsx
function resolveStatus(row: TransactionViewModel): "routine" | "pending" | "failed" | "expired" {
  if (row.type === "expiry") return "expired";
  // Future: derive "pending" / "failed" from metadata flags when Stripe webhook writes them.
  // MVP: everything non-expiry is routine.
  return "routine";
}

function buildSecondaryLine(
  row: TransactionViewModel,
  format: ReturnType<typeof useFormatter>,
  tBilling: ReturnType<typeof useTranslations>,
): string {
  const parts: string[] = [];
  if (row.billingType) {
    const key = row.billingType === "embedding" ? "indexing"
              : row.billingType === "extraction_llm" ? "extraction"
              : row.billingType;
    parts.push(tBilling(key));
  }
  parts.push(format.dateTime(new Date(row.createdAt), { dateStyle: "medium", timeStyle: "short" }));
  return parts.join(" · ");
}

function buildAriaLabel(row: TransactionViewModel, format: ReturnType<typeof useFormatter>): string {
  const sign = row.direction === "in" ? "credit" : "debit";
  const amt = format.number(row.amount);
  const date = format.dateTime(new Date(row.createdAt), { dateStyle: "medium" });
  return `${row.type} ${sign} ${amt} credits, ${date}`;
}
```

### 5. Refactor `components/billing/transactions-list.tsx`

```tsx
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { TransactionRow } from "@/components/billing/transactions/transaction-row";

export function TransactionsList() {
  const t = useTranslations("billingPage.transactions");
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawJobId = searchParams.get("jobId");
  const jobId = rawJobId ? (rawJobId as Id<"extractionJobs">) : undefined;

  const { data, settlement } = useProtectedQuery(
    api.credits.queries.getTransactions,
    jobId ? { jobId, limit: 200 } : { limit: 50 },
  );

  const rows = useMemo(
    () => (data ?? []).map(toViewModel),
    [data],
  );

  const clearJobFilter = () => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("jobId");
    const qs = next.toString();
    router.replace(`/settings/billing${qs ? `?${qs}` : ""}`);
  };

  return (
    <section
      role="region"
      aria-labelledby="transactions-heading"
      data-transactions-filter={jobId ?? "none"}
      className="rounded-xl border border-border/40 bg-card/90 p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="transactions-heading" className="text-base font-semibold tracking-tight">
          {t("title")}
        </h2>
        {jobId && (
          <Badge variant="secondary" className="gap-1.5">
            <Link href={`/extraction/${jobId}`} className="hover:underline">
              {t("filteredByJob")}
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4"
              onClick={clearJobFilter}
              aria-label={t("clearFilter")}
            >
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        )}
      </div>

      {settlement !== "ready" ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-transactions-empty="true">
          {jobId ? t("emptyForJob") : t("empty")}
        </p>
      ) : (
        <div role="list" className="flex flex-col divide-y divide-border/40">
          {rows.map((row) => (
            <TransactionRow key={row.id} row={row} density="comfortable" />
          ))}
        </div>
      )}
    </section>
  );
}
```

Key deltas from the current component:

- `rows` is now `TransactionViewModel[]` (not raw Convex docs). `toViewModel` runs inside `useMemo` so references are stable across subscription transitions — feeding `React.memo(TransactionRow)`'s identity check.
- `<ul>` becomes `<div role="list">` with `role="listitem"` on each row. We switch from `<ul>`/`<li>` because plan 06 adds a grid-style keyboard focus ring that `<ul>` semantics don't compose well with; `role="list"` + `role="listitem"` is idiomatic ARIA for custom list presentation.
- All rendering of the row content is now delegated to `<TransactionRow>`. The list component shrinks to orchestration only.

### 6. `next.config.ts` — `optimizePackageImports`

```ts
experimental: {
  // existing keys...
  optimizePackageImports: ["lucide-react"],
},
```

Verify after `npm run build` that the `lucide-react` chunk drops to < 10 KB (only used icons) per Vercel's benchmark. If the chunk is larger than expected, some import is still barrel-importing — grep for `import \* as ... from "lucide-react"` and convert to named.

### 7. i18n — `messages/en-US.json`

Add under `billingPage.transactions`:

```jsonc
{
  "type": {
    "purchase": "Credit purchase",
    "grant":    "Free credit grant",
    "refund":   "Refund",
    "usage":    "Usage",
    "expiry":   "Credits expired"
  },
  "billingType": {
    "extraction_llm": "Extraction",
    "embedding":      "Indexing",
    "screening":      "Screening",
    "chat":           "Chat"
  },
  "status": {
    "pending": "Pending",
    "failed":  "Failed",
    "expired": "Expired"
  },
  "actions": {
    "openJob": "Open job"
  }
  /* existing keys preserved */
}
```

Mirror in other locale JSONs (Project ships a translation workflow; mark `todo` keys if appropriate).

## TDD sequence — pure logic only

**None new.** All pure-logic modules shipped in plan 01. Plan 02 is test-after for UI components.

## Files touched

### New

- `components/billing/transactions/transaction-icon.tsx`
- `components/billing/transactions/transaction-amount.tsx`
- `components/billing/transactions/transaction-status-pill.tsx`
- `components/billing/transactions/transaction-row.tsx`
- `components/billing/transactions/transaction-icon.test.tsx`
- `components/billing/transactions/transaction-amount.test.tsx`
- `components/billing/transactions/transaction-status-pill.test.tsx`
- `components/billing/transactions/transaction-row.test.tsx`

### Modified

- `components/billing/transactions-list.tsx` — replace inline JSX with `<TransactionRow>`; project through `toViewModel`; swap `<ul>`/`<li>` to `<div role="list">`/`<div role="listitem">`.
- `next.config.ts` — add `lucide-react` to `experimental.optimizePackageImports`.
- `app/globals.css` — append `.txn-pulse` keyframes + reduced-motion override.
- `messages/en-US.json` (+ other locales) — new keys under `billingPage.transactions.{type,billingType,status,actions}`.

### Dependencies

- None.

## Migration stance — **none**

Pure UI refactor. No schema, no query, no mutation changes.

## Test plan

All assertions via `getByRole`, `getByText`, `data-*`. Never `toHaveClass`.

### `transaction-icon.test.tsx`

- Renders with `data-txn-type="purchase"` when passed a purchase row.
- Sub-icon appears with `data-txn-billing-type="embedding"` for a usage row with `billingType: "embedding"`.
- Sub-icon absent (`data-txn-billing-type="none"`) for a purchase row.
- All glyphs `aria-hidden="true"`; no SR leak.

### `transaction-amount.test.tsx`

- `direction="in"` renders a `+` prefix; `direction="out"` renders a `−` (U+2212) prefix.
- `status="routine" direction="in"` has emerald foreground (assert via `data-txn-direction="in"` + `data-txn-status="routine"` — not class).
- `status="failed"` renders `data-txn-status="failed"` and carries `text-destructive` (assert via computed-color check, not class — or just by the attribute).
- `density="spacious"` renders the balance-after line; `density="comfortable"` does not.

### `transaction-status-pill.test.tsx`

- `status="pending"` renders `data-txn-status-pill="pending"` with `role="status"`.
- The `.txn-pulse` class is applied (assert via `data-txn-status-pill="pending"` + a CSS-selector-based integration check, or skip and rely on manual QA + reduced-motion test).
- Text is localized via i18n key.

### `transaction-row.test.tsx`

- Exposes all `data-*` dimensions: `data-txn-id`, `data-txn-type`, `data-txn-direction`, `data-txn-credit-type`, `data-txn-billing-type`, `data-txn-status`, `data-txn-density`.
- Secondary line absent at `density="compact"`.
- Row is clickable: `onClick={spy}` fires when user clicks the row.
- Link-to-job button `onClick` is `stopPropagation`'d — clicking it does NOT trigger the row click spy.
- `aria-label` on the row describes the transaction: "purchase credit 1,240 credits, Apr 20, 2026".
- `role="listitem"` present.
- `id="txn-row-{id}"` set for aria-activedescendant (plan 06).
- Memoization: render twice with the same `row` reference → the inner render count is 1 (assert via a spy inside the component — or simply by asserting `queryByTestId` does not remount).

### `transactions-list.test.tsx` (existing file — new)

- Renders a `role="region"` with `aria-labelledby="transactions-heading"`.
- Renders `role="list"` containing N `role="listitem"` children when data is present.
- Loading: renders the loading text while `settlement !== "ready"`.
- Empty: renders `data-transactions-empty="true"` when no rows.
- Job filter badge renders when `?jobId=…` is in the URL.
- Clicking the clear-filter X calls `router.replace` with the jobId param removed.

### Accessibility (axe)

- Render the list at 10 rows → zero axe violations.
- Rows carry `role="listitem"` under a `role="list"` parent — axe accepts this pattern without warnings.
- Color contrast for `text-emerald-600` on card background meets WCAG AA; verify via axe's color-contrast rule.

### Manual QA

- Bring up `/settings/billing` with real data → visual sanity check: icons tint correctly, amounts right-align with `tabular-nums`, status pill appears on expired rows, hover reveals the "open job" button on usage rows.
- Toggle `prefers-reduced-motion: reduce` in DevTools → pending pulse stops.
- Inspect bundle: `next build --analyze` → `lucide-react` chunk < 10 KB.

## Acceptance criteria

- [ ] Four new row components land under `components/billing/transactions/` + test files for each.
- [ ] `components/billing/transactions-list.tsx` consumes `TransactionRow` and `toViewModel`; no inline row rendering remains.
- [ ] Every row exposes `data-txn-id`, `data-txn-type`, `data-txn-direction`, `data-txn-credit-type`, `data-txn-billing-type`, `data-txn-status`, `data-txn-density`.
- [ ] Routine debit rows render neutral foreground, not red.
- [ ] Expired rows render `data-txn-status="expired"` + left-border stripe + muted pill.
- [ ] `next.config.ts` has `lucide-react` in `experimental.optimizePackageImports`; post-build chunk < 10 KB.
- [ ] `app/globals.css` carries `.txn-pulse` + `prefers-reduced-motion` override.
- [ ] i18n keys for type / billingType / status / actions shipped in `messages/en-US.json`.
- [ ] Axe clean at 10 rows.
- [ ] Existing E2E billing spec(s) still pass unmodified.
- [ ] Visual QA in the dev server confirms the section no longer looks flat — icons, colors, and hierarchy visible.

## Known pitfalls

- **`color-mix(in oklch, ...)` browser support** — Chromium 111+, Safari 16.2+, Firefox 113+. All evergreen browsers support it. If the project supports older browsers, replace with a precomputed palette of 5 tint classes in `app/globals.css` and apply via `className`. Check the project's `browserslist` before shipping.
- **Inline `style={{ backgroundColor, color }}` and Tailwind JIT** — inline styles bypass Tailwind entirely, which is correct here (dynamic CSS-var value). Don't try to express this via a Tailwind arbitrary value — it won't work at JIT time.
- **`aria-hidden` on icons inside clickable rows** — correct pattern. The row's `aria-label` carries the full semantic description; SRs read the row label, not the icon.
- **`<ul>` → `<div role="list">` switch** — axe's `list` rule accepts both. But if any existing CSS targets `ul > li` in the billing section, it'll break. Grep before changing: `grep -rn 'li\[data-transaction' components/ app/`.
- **`React.memo` with custom equality** — the equality check must include every prop. Forgetting `onClick` lets plan 05's drawer handler bypass memoization. The comparator above explicitly compares every prop; do not remove props from the comparator without matching the signature.
- **`toViewModel` per-render cost** — called in `useMemo` keyed on `data`. For 50 rows this is nothing; for 1,000 rows (plan 03) it's still sub-millisecond. If profiling ever shows it, hoist into a dedicated `useTransactionViewModels` hook that batches per Convex subscription transition.
- **Pending / failed state derivation** — `resolveStatus` is a stub today (only `expiry` maps to a non-routine state). Plan 05 extends this as the Stripe webhook wiring surfaces `pending` / `failed` states via `metadata.stripeStatus`. Leaving the stub with explicit documentation is the right move, not over-engineering on speculation.
- **Unicode minus (U+2212) across themes** — renders cleanly in all project fonts (Inter, system-ui). If a theme introduces a monospace font where U+2212 doesn't align, fall back to `-`. Verify in dark + light.
- **`useFormatter` locale scope** — `format.number(1240)` returns `"1,240"` in `en-US`, `"1.240"` in `de-DE`. The `+` / `−` sign prefix is manual — don't use `format.number(amount, { signDisplay: "always" })` because the sign locale format differs from the one we want. Prepend the sign manually.
