/**
 * @vitest-environment jsdom
 *
 * Plan 05 axe audit for the detail drawer, rendered with a representative
 * row: description + linked job + Stripe section (all 4 ids) + 2-key
 * metadata. Asserts zero violations with the drawer open.
 *
 * color-contrast is disabled because JSDOM has no paint engine.
 */
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderWithTooltip as render } from "../helpers/render-with-tooltip";
import { axe, toHaveNoViolations } from "jest-axe";

import { TransactionDetailDrawer } from "@/components/billing/transactions/transaction-detail-drawer";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";

vi.mock("next-intl", () => ({
  // Scoped useTranslations mock: returns "{namespace}.{key}" so that
  // drawer.links.heading and drawer.metadata.heading resolve to distinct
  // strings. Without the namespace prefix every section's <h3> collapses to
  // the string "heading", which axe flags as a landmark-unique violation.
  useTranslations: (namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const base = namespace ? `${namespace}.${key}` : key;
      return params
        ? `${base}:${Object.entries(params)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(",")}`
        : base;
    },
  useFormatter: () => ({
    number: (n: number) => String(n),
    dateTime: (d: Date) =>
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeStyle: "short",
      }).format(d),
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

const representative: TransactionViewModel = {
  id: "tx-rep",
  type: "purchase",
  creditType: "paid",
  billingType: null,
  direction: "in",
  amount: 1240,
  signedAmount: 1240,
  description: "Top-up 1,240 credits",
  createdAt: Date.UTC(2026, 3, 20, 10, 0, 0),
  jobId: "job_abc",
  paperId: "paper_xyz",
  resultId: null,
  stripeInvoiceId: "in_abc123",
  stripePaymentIntentId: "pi_xyz789",
  stripeChargeId: "ch_lmn456",
  stripeCheckoutSessionId: "cs_opq321",
  metadata: {
    source: "stripe-webhook",
    reconciled: "true",
  },
  hasStripe: true,
  paperTitle: null,
  jobName: null,
  openalexRef: null,
  modelLabel: null,
  tokenSummary: null,
};

const AXE_OPTIONS = {
  rules: {
    "color-contrast": { enabled: false },
  },
};

describe("TransactionDetailDrawer axe", () => {
  it("has zero axe violations when open with a fully-populated row", async () => {
    render(
      <TransactionDetailDrawer row={representative} onOpenChange={vi.fn()} />,
    );
    // Radix portals the Sheet content to document.body — wait for it to mount.
    await waitFor(() =>
      expect(
        document.querySelector("[data-transaction-drawer]"),
      ).not.toBeNull(),
    );
    expect(await axe(document.body, AXE_OPTIONS)).toHaveNoViolations();
  });
});
