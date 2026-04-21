import { describe, expect, it } from "vitest";

import {
  CSV_COLUMNS,
  escapeCsvField,
  toCsv,
  toCsvRow,
} from "./export-csv";
import type { TransactionViewModel } from "./transaction-view-model";

function row(
  partial: Partial<TransactionViewModel> & Pick<TransactionViewModel, "id">,
): TransactionViewModel {
  return {
    id: partial.id,
    type: partial.type ?? "purchase",
    creditType: partial.creditType ?? "paid",
    billingType: partial.billingType ?? null,
    direction: partial.direction ?? "in",
    amount: partial.amount ?? 100,
    signedAmount: partial.signedAmount ?? 100,
    balanceAfter: partial.balanceAfter ?? 1000,
    description: partial.description ?? null,
    createdAt: partial.createdAt ?? 0,
    jobId: partial.jobId ?? null,
    paperId: partial.paperId ?? null,
    resultId: partial.resultId ?? null,
    stripeInvoiceId: partial.stripeInvoiceId ?? null,
    stripePaymentIntentId: partial.stripePaymentIntentId ?? null,
    stripeChargeId: partial.stripeChargeId ?? null,
    stripeCheckoutSessionId: partial.stripeCheckoutSessionId ?? null,
    metadata: partial.metadata ?? {},
    hasStripe: partial.hasStripe ?? false,
    paperTitle: partial.paperTitle ?? null,
    jobName: partial.jobName ?? null,
    openalexRef: partial.openalexRef ?? null,
    modelLabel: partial.modelLabel ?? null,
    tokenSummary: partial.tokenSummary ?? null,
  };
}

// Minimal RFC 4180 parser — single-pass state machine.
// Splits records on unquoted CRLF/LF, fields on unquoted commas,
// and unescapes doubled quotes inside quoted fields.
function parseCsv(input: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      record.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n" || c === "\r") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      if (c === "\r" && input[i + 1] === "\n") i += 2;
      else i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  record.push(field);
  if (record.length > 1 || record[0] !== "") records.push(record);
  return records;
}

describe("escapeCsvField", () => {
  it("leaves plain strings untouched", () => {
    expect(escapeCsvField("hello")).toBe("hello");
  });

  it("wraps fields containing a comma in double quotes", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("doubles interior quotes and wraps in quotes", () => {
    expect(escapeCsvField('quote"inside')).toBe('"quote""inside"');
  });

  it("wraps fields containing a newline in double quotes", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps fields containing a carriage return in double quotes", () => {
    expect(escapeCsvField("line1\rline2")).toBe('"line1\rline2"');
  });

  it("renders null as an empty string", () => {
    expect(escapeCsvField(null)).toBe("");
  });

  it("renders undefined as an empty string", () => {
    expect(escapeCsvField(undefined)).toBe("");
  });

  it("renders numbers via String() without quoting", () => {
    expect(escapeCsvField(1234)).toBe("1234");
    expect(escapeCsvField(-0.5)).toBe("-0.5");
  });

  it("escapes a field containing all three special chars", () => {
    expect(escapeCsvField('a, "b"\nc')).toBe('"a, ""b""\nc"');
  });
});

describe("CSV_COLUMNS", () => {
  it("contains 16 columns in the documented order", () => {
    expect(CSV_COLUMNS).toEqual([
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
    ]);
  });

  it("has no duplicate column names", () => {
    expect(new Set(CSV_COLUMNS).size).toBe(CSV_COLUMNS.length);
  });
});

describe("toCsvRow", () => {
  it("renders all 16 fields in column order", () => {
    const createdAt = Date.UTC(2026, 3, 20, 9, 30, 0);
    const r = row({
      id: "tx-1",
      createdAt,
      type: "purchase",
      direction: "in",
      creditType: "paid",
      billingType: null,
      description: "Top-up",
      signedAmount: 1000,
      balanceAfter: 1500,
      stripeInvoiceId: "in_abc",
      stripePaymentIntentId: "pi_xyz",
      stripeChargeId: null,
      stripeCheckoutSessionId: null,
      jobId: null,
      paperId: null,
      resultId: null,
    });
    expect(toCsvRow(r)).toBe(
      [
        "tx-1",
        new Date(createdAt).toISOString(),
        "purchase",
        "in",
        "paid",
        "",
        "Top-up",
        "1000",
        "1500",
        "in_abc",
        "pi_xyz",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
    );
  });

  it("escapes a description containing a comma", () => {
    const r = row({ id: "tx-2", description: "Comma, inside" });
    const line = toCsvRow(r);
    expect(line).toContain('"Comma, inside"');
  });

  it("escapes a description containing a quote", () => {
    const r = row({ id: "tx-3", description: 'Quote "inside"' });
    const line = toCsvRow(r);
    expect(line).toContain('"Quote ""inside"""');
  });

  it("escapes a description containing a newline", () => {
    const r = row({ id: "tx-4", description: "Line\nbreak" });
    const line = toCsvRow(r);
    expect(line).toContain('"Line\nbreak"');
  });

  it("renders createdAt as an ISO 8601 timestamp", () => {
    const r = row({ id: "tx-5", createdAt: Date.UTC(2026, 0, 1, 0, 0, 0) });
    const parts = toCsvRow(r).split(",");
    expect(parts[1]).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("toCsv", () => {
  it("renders only the header when the row list is empty", () => {
    expect(toCsv([])).toBe(CSV_COLUMNS.join(","));
  });

  it("prepends the column header then joins rows by LF", () => {
    const r1 = row({ id: "a", createdAt: Date.UTC(2026, 0, 1) });
    const r2 = row({ id: "b", createdAt: Date.UTC(2026, 0, 2) });
    const out = toCsv([r1, r2]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines[1].startsWith("a,")).toBe(true);
    expect(lines[2].startsWith("b,")).toBe(true);
  });

  it("round-trips through a conforming RFC-4180 parser", () => {
    const rows = [
      row({
        id: "r1",
        description: 'Comma, quote ", and\nnewline',
        signedAmount: -42,
      }),
      row({ id: "r2", description: null, stripeInvoiceId: "in_123" }),
    ];
    const csv = toCsv(rows);
    const parsed = parseCsv(csv);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual([...CSV_COLUMNS]);
    expect(parsed[1][0]).toBe("r1");
    expect(parsed[1][6]).toBe('Comma, quote ", and\nnewline');
    expect(parsed[1][7]).toBe("-42");
    expect(parsed[2][0]).toBe("r2");
    expect(parsed[2][6]).toBe("");
    expect(parsed[2][9]).toBe("in_123");
  });
});
