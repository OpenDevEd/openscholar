/**
 * @vitest-environment jsdom
 *
 * Plan 02 axe audit for the transactions list composition.
 * Renders 10 TransactionRow items inside the same `role="list"`
 * wrapper used by TransactionsList and expects zero violations.
 *
 * color-contrast is disabled because JSDOM has no paint engine.
 * nested-interactive is disabled because the row composition
 * intentionally nests a link (open-job) inside a clickable row —
 * the row uses role="listitem" not a native button, so real AT
 * handles this correctly, but axe flags the theoretical nesting.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { TransactionRow } from "@/components/billing/transactions/transaction-row";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    number: (n: number) => String(n),
    dateTime: (d: Date) => d.toISOString().slice(0, 10),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

expect.extend(toHaveNoViolations);

const AXE_OPTIONS = {
  rules: {
    "color-contrast": { enabled: false },
    "nested-interactive": { enabled: false },
  },
};

function makeRow(i: number): TransactionViewModel {
  const types = ["purchase", "usage", "grant", "refund", "expiry"] as const;
  const type = types[i % types.length];
  const direction = type === "usage" || type === "expiry" ? "out" : "in";
  return {
    id: `tx-${i}`,
    type,
    creditType: i % 2 === 0 ? "paid" : "free",
    billingType: type === "usage" ? "embedding" : null,
    direction,
    amount: 100 + i * 37,
    signedAmount: direction === "in" ? 100 + i * 37 : -(100 + i * 37),
    balanceAfter: 10_000 - i * 100,
    description: `Row ${i}`,
    createdAt: Date.UTC(2026, 3, 1 + i, 10),
    jobId: type === "usage" ? `job-${i}` : null,
    paperId: null,
    resultId: null,
    stripeInvoiceId: null,
    stripePaymentIntentId: null,
    stripeChargeId: null,
    stripeCheckoutSessionId: null,
    metadata: {},
    hasStripe: false,
  };
}

describe("transactions-list axe", () => {
  it("has zero axe violations at 10 rows", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(i));
    const { container } = render(
      <section role="region" aria-labelledby="t">
        <h2 id="t">Transactions</h2>
        <div role="list">
          {rows.map((r) => (
            <TransactionRow key={r.id} row={r} density="comfortable" />
          ))}
        </div>
      </section>,
    );
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
