# Plan 05 — Detail Drawer + CSV Export

**Depends on:** 04 (toolbar + URL state). **Blocks:** 06.

## Goal

Row click (or Enter on an active row — plan 06) opens a right-side shadcn `Sheet` drawer carrying the full transaction detail — description un-clamped, big tabular-nums amount with running balance, credit-pool + status badges, copyable Stripe IDs with outbound links and receipt-PDF button, linked job / paper / result cards, collapsible metadata KV table. Dynamic-imported via `next/dynamic` with `ssr: false` to keep the initial bundle small. Export button in the header gets wired to a CSV generator with two modes: "Export current view" (filtered) and "Export all" (full dataset — queried server-side with larger page size). Pure CSV logic TDD-first.

Implements decisions **D12** (drawer + dynamic import), **D14** (drawer surfaces copyable Stripe links + receipt), **D17** (CSV export).

## Scope

**In scope**

- New `components/billing/transactions/transaction-detail-drawer.tsx` — right-side `Sheet` with structured detail layout.
- New `components/billing/transactions/drawer-stripe-section.tsx` — IDs + copy buttons + outbound link + receipt download.
- New `components/billing/transactions/drawer-linked-entities.tsx` — cards linking to job / paper / result when ids present.
- New `components/billing/transactions/drawer-metadata-table.tsx` — collapsible KV table.
- New `components/billing/transactions/use-copy-to-clipboard.ts` — small utility hook with "copied!" feedback.
- New `lib/billing/transactions/export-csv.ts` — pure CSV generator; TDD'd.
- New `components/billing/transactions/transactions-export-menu.tsx` — dropdown behind the header's Export button; "Current view" / "All time".
- Wire row click (`onClick={(row) => setDetailRow(row)}`) in `transactions-panel-client.tsx`; drawer open state is local React state, not URL state (drawer is transient).
- i18n: drawer labels, copy/receipt buttons, export menu items, Stripe link descriptions.

**Out of scope**

- Keyboard-open drawer via Enter (plan 06).
- Bulk-select export (post-MVP; would plug into plan 06's selection model).
- Refund / dispute action buttons (admin-only, out of scope).
- Real-time receipt-PDF proxy (we link direct to Stripe's hosted invoice URL; no server proxy).

## Design

### 1. Dynamic import wiring

In `transactions-panel-client.tsx`:

```tsx
import dynamic from "next/dynamic";

const TransactionDetailDrawer = dynamic(
  () => import("./transaction-detail-drawer").then((m) => m.TransactionDetailDrawer),
  { ssr: false },
);

// inside the component:
const [detailRow, setDetailRow] = useState<TransactionViewModel | null>(null);

// pass to rows:
<TransactionRow key={row.id} row={row} density={state.density} onClick={setDetailRow} />

// and render the drawer at the panel root:
<TransactionDetailDrawer
  row={detailRow}
  onOpenChange={(open) => { if (!open) setDetailRow(null); }}
/>
```

Dynamic import cuts ~30–60 KB from the first-load JS for users who never click a row.

### 2. `transaction-detail-drawer.tsx`

```tsx
"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { TransactionIcon } from "./transaction-icon";
import { DrawerStripeSection } from "./drawer-stripe-section";
import { DrawerLinkedEntities } from "./drawer-linked-entities";
import { DrawerMetadataTable } from "./drawer-metadata-table";

interface Props {
  row: TransactionViewModel | null;
  onOpenChange: (open: boolean) => void;
}

export function TransactionDetailDrawer({ row, onOpenChange }: Props) {
  const t = useTranslations("billingPage.transactions.drawer");
  const format = useFormatter();

  return (
    <Sheet open={row != null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[min(480px,92vw)] flex-col gap-0 p-0"
        data-transaction-drawer
      >
        {row && (
          <>
            <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
              <div className="flex items-center gap-3">
                <TransactionIcon type={row.type} billingType={row.billingType} />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-sm font-semibold">
                    {row.description ?? t(`type.${row.type}`)}
                  </SheetTitle>
                  <p className="text-[11px] text-muted-foreground">
                    {format.dateTime(new Date(row.createdAt), { dateStyle: "full", timeStyle: "short" })}
                  </p>
                </div>
              </div>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label={t("close")}>
                  <X className="size-4" />
                </Button>
              </SheetClose>
            </SheetHeader>

            <div className="flex flex-col gap-4 overflow-auto px-4 py-4" data-drawer-body>
              {/* Amount block */}
              <div className="flex flex-col gap-1" data-drawer-section="amount">
                <span
                  className={cn(
                    "text-3xl font-semibold tabular-nums",
                    row.direction === "in" && "text-emerald-600 dark:text-emerald-500",
                  )}
                >
                  {row.direction === "in" ? "+" : "\u2212"}{format.number(row.amount)}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("balanceAfter", { balance: format.number(row.balanceAfter) })}
                </span>
              </div>

              {/* Badge row */}
              <div className="flex flex-wrap gap-1.5" data-drawer-section="badges">
                <Badge variant="outline" data-drawer-badge="credit-pool" data-value={row.creditType}>
                  {t(`creditPool.${row.creditType}`)}
                </Badge>
                {row.billingType && (
                  <Badge variant="outline" data-drawer-badge="billing-type" data-value={row.billingType}>
                    {t(`billingType.${row.billingType}`)}
                  </Badge>
                )}
                <Badge variant="outline" data-drawer-badge="type" data-value={row.type}>
                  {t(`type.${row.type}`)}
                </Badge>
              </div>

              {/* Linked entities */}
              {(row.jobId || row.paperId || row.resultId) && (
                <DrawerLinkedEntities
                  jobId={row.jobId}
                  paperId={row.paperId}
                  resultId={row.resultId}
                />
              )}

              {/* Stripe section */}
              {row.hasStripe && (
                <DrawerStripeSection
                  invoiceId={row.stripeInvoiceId}
                  paymentIntentId={row.stripePaymentIntentId}
                  chargeId={row.stripeChargeId}
                  checkoutSessionId={row.stripeCheckoutSessionId}
                />
              )}

              {/* Metadata */}
              {Object.keys(row.metadata).length > 0 && (
                <DrawerMetadataTable metadata={row.metadata} />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

Drawer animation: shadcn `Sheet`'s built-in `data-[state=open]:translate-x-0` handles the slide. `prefers-reduced-motion` is respected by the primitive.

### 3. `use-copy-to-clipboard.ts`

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useCopyToClipboard() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Clipboard denied — fail silently; the user can still read the ID.
    }
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return { copy, copiedKey };
}
```

### 4. `drawer-stripe-section.tsx`

```tsx
"use client";

import { Copy, Check, ExternalLink, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "./use-copy-to-clipboard";

interface Props {
  invoiceId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  checkoutSessionId: string | null;
}

const STRIPE_DASHBOARD = "https://dashboard.stripe.com";

export function DrawerStripeSection({ invoiceId, paymentIntentId, chargeId, checkoutSessionId }: Props) {
  const t = useTranslations("billingPage.transactions.drawer.stripe");
  const { copy, copiedKey } = useCopyToClipboard();

  const rows: Array<{ key: string; label: string; value: string; href?: string }> = [];
  if (invoiceId)         rows.push({ key: "invoice",  label: t("invoice"),         value: invoiceId,         href: `${STRIPE_DASHBOARD}/invoices/${invoiceId}` });
  if (paymentIntentId)   rows.push({ key: "pi",       label: t("paymentIntent"),   value: paymentIntentId,   href: `${STRIPE_DASHBOARD}/payments/${paymentIntentId}` });
  if (chargeId)          rows.push({ key: "charge",   label: t("charge"),          value: chargeId,          href: `${STRIPE_DASHBOARD}/payments/${chargeId}` });
  if (checkoutSessionId) rows.push({ key: "checkout", label: t("checkoutSession"), value: checkoutSessionId });

  return (
    <section
      data-drawer-section="stripe"
      aria-labelledby="drawer-stripe-heading"
      className="rounded-lg border border-border/50 p-3"
    >
      <h3 id="drawer-stripe-heading" className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("heading")}
      </h3>
      <dl className="flex flex-col gap-1.5">
        {rows.map(({ key, label, value, href }) => (
          <div key={key} className="flex items-center gap-2" data-stripe-field={key}>
            <dt className="w-28 shrink-0 text-[11px] text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-1">
              <code className="truncate font-mono text-[11px]" title={value}>{value}</code>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t("copy")}
                onClick={() => copy(value, key)}
              >
                {copiedKey === key ? <Check className="size-3" /> : <Copy className="size-3" />}
              </Button>
              {href && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t("openInStripe")}
                  asChild
                >
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-3" />
                  </a>
                </Button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {invoiceId && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full gap-1.5 text-xs"
          asChild
          data-drawer-receipt-download
        >
          <a href={`${STRIPE_DASHBOARD}/invoices/${invoiceId}?print=true`} target="_blank" rel="noopener noreferrer">
            <Download className="size-3.5" aria-hidden />
            {t("downloadReceipt")}
          </a>
        </Button>
      )}
    </section>
  );
}
```

**Note on dashboard vs customer-portal URLs**: the admin dashboard URLs above are correct for the developer account view. If a customer needs their own receipt, Stripe's hosted invoice URL (`https://invoice.stripe.com/…`) is the right target. Plan 01's view-model doesn't carry the hosted URL — plan 05's execution should grep the Stripe webhook handler to see if `hosted_invoice_url` is captured in `metadata`; if not, either (a) add the field to the schema + webhook, or (b) use the admin URL and accept that non-admin users get "Access denied" (bad UX — must fix). **Prefer (a)** but the schema widening is out of scope here — document as a follow-up papercut in the execution commit.

### 5. `drawer-linked-entities.tsx`

```tsx
"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

interface Props {
  jobId: string | null;
  paperId: string | null;
  resultId: string | null;
}

export function DrawerLinkedEntities({ jobId, paperId, resultId }: Props) {
  const t = useTranslations("billingPage.transactions.drawer.links");
  const links: Array<{ key: string; href: string; label: string }> = [];
  if (jobId)    links.push({ key: "job",    href: `/extraction/${jobId}`,               label: t("job") });
  if (paperId)  links.push({ key: "paper",  href: `/extraction/paper/${paperId}`,       label: t("paper") });
  if (resultId) links.push({ key: "result", href: `/extraction/result/${resultId}`,     label: t("result") });

  return (
    <section data-drawer-section="linked" className="flex flex-col gap-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("heading")}
      </h3>
      {links.map(({ key, href, label }) => (
        <Link
          key={key}
          href={href}
          className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-xs hover:bg-muted/40"
          data-drawer-link={key}
        >
          {label}
          <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
        </Link>
      ))}
    </section>
  );
}
```

Verify at execution time that the `/extraction/paper/[id]` and `/extraction/result/[id]` routes exist or map correctly — if paper/result are nested under job, adjust the URL. Delegate to an Explore agent: "grep for routes matching `app/extraction/**/page.tsx` and report the link patterns used for paper and result detail views."

### 6. `drawer-metadata-table.tsx`

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

interface Props { metadata: Record<string, string>; }

export function DrawerMetadataTable({ metadata }: Props) {
  const t = useTranslations("billingPage.transactions.drawer.metadata");
  const [open, setOpen] = useState(false);
  const entries = Object.entries(metadata);

  return (
    <section data-drawer-section="metadata" className="rounded-lg border border-border/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        data-drawer-metadata-toggle
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("heading")} <span className="tabular-nums">({entries.length})</span>
        </span>
        {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <dl className="flex flex-col gap-1 px-3 pb-3 text-[11px]">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-2" data-metadata-key={k}>
              <dt className="w-28 shrink-0 font-mono text-muted-foreground">{k}</dt>
              <dd className="truncate font-mono" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
```

### 7. `lib/billing/transactions/export-csv.ts`

Pure CSV generator — string in, string out. Escape rules per RFC 4180: fields with `,`, `"`, newlines get wrapped in `"…"` with internal `"` doubled.

```ts
import type { TransactionViewModel } from "./transaction-view-model";

export const CSV_COLUMNS = [
  "id", "createdAt", "type", "direction", "creditType", "billingType",
  "description", "signedAmount", "balanceAfter",
  "stripeInvoiceId", "stripePaymentIntentId", "stripeChargeId", "stripeCheckoutSessionId",
  "jobId", "paperId", "resultId",
] as const;

export type CsvColumn = typeof CSV_COLUMNS[number];

export function escapeCsvField(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  const needsQuotes = /[",\n\r]/.test(str);
  if (!needsQuotes) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export function toCsvRow(row: TransactionViewModel, columns: readonly CsvColumn[] = CSV_COLUMNS): string {
  return columns.map((col) => {
    if (col === "createdAt") return escapeCsvField(new Date(row.createdAt).toISOString());
    return escapeCsvField((row as unknown as Record<string, unknown>)[col]);
  }).join(",");
}

export function toCsv(rows: readonly TransactionViewModel[], columns: readonly CsvColumn[] = CSV_COLUMNS): string {
  const header = columns.join(",");
  const body = rows.map((r) => toCsvRow(r, columns)).join("\n");
  return `${header}\n${body}`;
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
```

### 8. `transactions-export-menu.tsx`

```tsx
"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";
import { toCsv, downloadCsv } from "@/lib/billing/transactions/export-csv";

interface Props {
  currentView: readonly TransactionViewModel[];
  fetchAll: () => Promise<readonly TransactionViewModel[]>;   // provided by client island
}

export function TransactionsExportMenu({ currentView, fetchAll }: Props) {
  const t = useTranslations("billingPage.transactions.export");
  const format = useFormatter();
  const [loading, setLoading] = useState(false);

  const exportCurrent = () => {
    const csv = toCsv(currentView);
    downloadCsv(csv, `transactions-${new Date().toISOString().slice(0,10)}.csv`);
  };

  const exportAll = async () => {
    setLoading(true);
    try {
      const all = await fetchAll();
      const csv = toCsv(all);
      downloadCsv(csv, `transactions-all-${new Date().toISOString().slice(0,10)}.csv`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          data-transactions-export-trigger
          disabled={loading}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
          {t("label")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem
          onClick={exportCurrent}
          data-export-mode="current"
          className="text-xs"
          disabled={currentView.length === 0}
        >
          {t("current", { count: currentView.length })}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={exportAll}
          data-export-mode="all"
          className="text-xs"
          disabled={loading}
        >
          {t("all")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 9. `fetchAll` — server-side path

`fetchAll` queries Convex with `paginationOpts: { numItems: 500, cursor: null }` and recursively drains pages until `isDone === true`. Implemented in the client island:

```tsx
// transactions-panel-client.tsx
import { useConvex } from "convex/react";

const convex = useConvex();

const fetchAll = useCallback(async (): Promise<TransactionViewModel[]> => {
  const collected: TransactionViewModel[] = [];
  let cursor: string | null = null;
  do {
    const page = await convex.query(api.credits.queries.getTransactions, {
      paginationOpts: { numItems: 500, cursor },
      // Intentionally no filter args — "export all" means all.
    });
    if (Array.isArray(page)) break;  // fallback path returned an array; shouldn't happen here
    collected.push(...page.page.map(toViewModel));
    cursor = page.isDone ? null : page.continueCursor;
  } while (cursor != null);
  return collected;
}, [convex]);
```

Pass `fetchAll` into `<TransactionsExportMenu fetchAll={fetchAll} currentView={rows} />` in the header.

## TDD sequence — pure logic

Commit after each green.

### `export-csv.ts`

1. RED: `escapeCsvField("hello")` → `"hello"` (no quotes).
2. RED: `escapeCsvField("a,b")` → `"\"a,b\""` (wrap in quotes).
3. RED: `escapeCsvField('quote"inside')` → `"\"quote\"\"inside\""` (double the inner quote).
4. RED: `escapeCsvField("line1\nline2")` wraps in quotes.
5. RED: `escapeCsvField(null)` → `""`.
6. RED: `escapeCsvField(undefined)` → `""`.
7. RED: `escapeCsvField(1234)` → `"1234"`.
8. RED: `toCsvRow` with all 16 fields renders in column order.
9. RED: `toCsv([])` renders only the header.
10. RED: `toCsv([row1, row2])` renders header + 2 body lines, joined by `\n`.
11. RED: `CSV_COLUMNS` contains 16 unique columns in the documented order.

All green → commit.

`downloadCsv` is not TDD'd — it invokes browser APIs. Tested manually.

## Files touched

### New

- `components/billing/transactions/transaction-detail-drawer.tsx`
- `components/billing/transactions/drawer-stripe-section.tsx`
- `components/billing/transactions/drawer-linked-entities.tsx`
- `components/billing/transactions/drawer-metadata-table.tsx`
- `components/billing/transactions/use-copy-to-clipboard.ts`
- `components/billing/transactions/transactions-export-menu.tsx`
- `lib/billing/transactions/export-csv.ts`
- `lib/billing/transactions/export-csv.test.ts`
- `components/billing/transactions/transaction-detail-drawer.test.tsx`
- `components/billing/transactions/drawer-stripe-section.test.tsx`
- `components/billing/transactions/transactions-export-menu.test.tsx`

### Modified

- `components/billing/transactions/transactions-panel-client.tsx` — dynamic-import drawer; drawer state; `fetchAll` via `useConvex`; pass row `onClick` handler; mount `TransactionsExportMenu` replacing the stub export button.
- `components/billing/transactions/transactions-panel-header.tsx` — accept `export={…}` slot prop, render `<TransactionsExportMenu />` instead of the disabled stub.
- `messages/en-US.json` — drawer, stripe, export, metadata labels.

### Dependencies

- None. `next/dynamic`, `convex/react`, shadcn `Sheet` + `DropdownMenu` all already in place.

## Migration stance — **none**

If the Stripe hosted invoice URL is not currently captured in webhook metadata, either accept the admin-dashboard-URL limitation (call it out in the PR description) or extend the webhook + schema in a separate follow-up plan. The plan writes against what the schema has today.

## Test plan

### `export-csv.test.ts`

Per TDD sequence. Additional:

- Row with `description: "Comma, inside"` produces correctly-escaped CSV.
- Row with `description: 'Quote "inside"'` double-escapes.
- Row with `description: "Line\nbreak"` wraps in quotes.
- Integration: round-trip through a parser (e.g. `papaparse` or hand-parser) — the parsed data matches input.

### `transaction-detail-drawer.test.tsx`

- Drawer hidden when `row === null`.
- Drawer opens with `data-transaction-drawer` when `row` set.
- Title = `row.description` or type label fallback when description null.
- Amount block shows sign + tabular-nums.
- Balance-after label rendered.
- Badges for credit-pool + billing-type + type appear with `data-drawer-badge` + `data-value`.
- Close button: clicking calls `onOpenChange(false)`.
- Escape key closes drawer (shadcn `Sheet` default behavior; assert by `userEvent.keyboard("{Escape}")`).

### `drawer-stripe-section.test.tsx`

- Only renders rows for non-null IDs.
- Copy button click → `navigator.clipboard.writeText` called with the correct ID.
- After copy, `data-stripe-field` button icon swaps to Check for 1.5s.
- Stripe dashboard link: `target="_blank"`, `rel="noopener noreferrer"`, `href` contains the correct path.
- Receipt download button only present when `invoiceId` set.

### `transactions-export-menu.test.tsx`

- "Current view" disabled when `currentView.length === 0`.
- "Current view" click → calls `downloadCsv` with expected filename pattern `transactions-{date}.csv`.
- "All" click → shows Loader2 icon + calls `fetchAll`, then `downloadCsv`.
- `fetchAll` rejection → Loader2 removed, button re-enabled.
- `data-export-mode` attribute per item.

### Accessibility (axe)

- Drawer open with representative content → zero violations.
- Focus trap: Tab cycles within drawer; Shift+Tab reverse; Escape closes and returns focus to the invoking row.
- `aria-labelledby` links `<SheetTitle>` to content.

### Manual QA

- Click a row → drawer slides in from the right.
- Copy a Stripe ID → paste elsewhere to verify.
- Click "Open in Stripe" → opens Stripe dashboard in new tab with correct path.
- Click "Download receipt" on a `stripeInvoiceId` row → opens hosted invoice print view.
- Export current view → CSV downloads, opens cleanly in Excel / Sheets / Numbers.
- Export all → Loader2 shows; CSV downloads with all rows.
- Reduced-motion → drawer appears without animation.
- Drawer is dynamic-imported: confirm via `next build --analyze` that the drawer chunk is separate from the initial chunk.

## Acceptance criteria

- [ ] `TransactionDetailDrawer` dynamic-imported via `next/dynamic` with `ssr: false`.
- [ ] Row click opens drawer; Escape closes; focus returns to originating row.
- [ ] Drawer shows: header with icon + title + timestamp, amount block with sign + balance-after, credit-pool + type + billingType badges, linked-entity cards (if any), Stripe section with copy + Stripe-dashboard links + receipt download (if `invoiceId`), collapsible metadata table.
- [ ] `use-copy-to-clipboard` works in Chromium + Firefox + Safari; graceful fallback on denial.
- [ ] `export-csv.ts` passes all TDD cases including RFC-4180 escaping.
- [ ] Export menu: "Current view" and "All" both produce valid CSVs with timestamped filenames.
- [ ] `fetchAll` drains Convex pagination; UI shows Loader2 during fetch.
- [ ] Axe clean on drawer + export menu.
- [ ] Bundle analyzer shows drawer chunk is separate (≥ 20 KB saved from first load).
- [ ] Drawer does not open on SSR / prerender (no hydration mismatch).

## Known pitfalls

- **`ssr: false` + Next.js 15** — `dynamic(() => ..., { ssr: false })` is supported. For Next 16+, if the API changes, use `next/dynamic` with a Client Component wrapper. Verify at execution.
- **Escape key + nested popovers** — if the toolbar's sort menu is open and the drawer opens, Escape may close the sort menu first. Acceptable and expected.
- **Focus management on close** — shadcn `Sheet` returns focus to the trigger when possible. Since the drawer is opened by a row click (not a standalone button with a React ref), focus may land on `<body>`. Fix: the row carries `tabIndex={-1}` by default; wrap the onClick with a focus-ref capture — `ref.current?.focus()` in the close handler. Plan 06 formalizes this; plan 05's test plan marks it as a known a11y papercut.
- **Clipboard API permission** — `navigator.clipboard.writeText` may throw `DOMException: Document is not focused` if called outside a user gesture or when the document is hidden. We call it from a click handler; should be fine. Don't chain multiple clipboard calls in one tick.
- **Download filename** — browsers sanitize `/` and `:` in filenames. The `toISOString().slice(0,10)` format is `YYYY-MM-DD`, safe across browsers.
- **CSV BOM** — Excel on Windows may not detect UTF-8 encoding without a BOM. Prepend `\uFEFF` to the CSV string if the target user is Excel-heavy. Plan 05 ships without BOM by default; add a checkbox in export menu "Excel-compatible (adds BOM)" if feedback demands.
- **`fetchAll` on huge datasets** — caps at 500 per page. A user with 10,000 transactions pulls 20 pages — ~20 network round-trips, ~10 seconds. Consider a progress indicator in the button text: "Exporting… 500 / ?"). Defer until feedback.
- **Stripe dashboard URL vs hosted invoice URL** — as noted, the admin dashboard URL is wrong for customers. Preferred: capture `hosted_invoice_url` in the webhook + schema, then use it here. Acceptable for plan 05 MVP: link to dashboard (developers) + mark a follow-up. Document in the PR.
- **Linked-entity routes** — `/extraction/paper/{id}` and `/extraction/result/{id}` may not exist. Delegate an Explore agent to grep the route tree. If the routes don't exist, render a disabled card labeled "Paper (link coming soon)" rather than a broken link.
- **`row.metadata` with sensitive keys** — if the webhook writes PII or auth tokens into metadata, the drawer leaks them. Filter at the schema / webhook layer, not the UI. Flag during execution: grep the webhook to see what keys are written.
- **`Sheet` z-index** — shadcn `Sheet` uses a high z-index (50+). Any toasts or popovers opened while the drawer is open stack correctly by default. Verify against the app's actual notification system.
