import type { TransactionViewModel } from "./transaction-view-model";

export const CSV_COLUMNS = [
  "id",
  "createdAt",
  "type",
  "direction",
  "creditType",
  "billingType",
  "description",
  "signedAmount",
  "balanceAfter",
  "stripeInvoiceId",
  "stripePaymentIntentId",
  "stripeChargeId",
  "stripeCheckoutSessionId",
  "jobId",
  "paperId",
  "resultId",
] as const satisfies readonly (keyof TransactionViewModel)[];

export type CsvColumn = (typeof CSV_COLUMNS)[number];

const SPECIAL = /[",\n\r]/;

export function escapeCsvField(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  if (!SPECIAL.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export function toCsvRow(
  row: TransactionViewModel,
  columns: readonly CsvColumn[] = CSV_COLUMNS,
): string {
  return columns
    .map((col) => {
      if (col === "createdAt") {
        return escapeCsvField(new Date(row.createdAt).toISOString());
      }
      return escapeCsvField(row[col]);
    })
    .join(",");
}

export function toCsv(
  rows: readonly TransactionViewModel[],
  columns: readonly CsvColumn[] = CSV_COLUMNS,
): string {
  const header = columns.join(",");
  if (rows.length === 0) return header;
  const body = rows.map((r) => toCsvRow(r, columns)).join("\n");
  return `${header}\n${body}`;
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
