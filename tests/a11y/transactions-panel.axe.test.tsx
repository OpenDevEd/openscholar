/**
 * @vitest-environment jsdom
 *
 * Plan 03 axe audit for the full transactions panel (header + sticky
 * group headers + rows). Renders via the client component with a stubbed
 * useProtectedPaginatedQuery (10 rows spanning today / yesterday / a
 * previous month) and expects zero violations.
 *
 * color-contrast is disabled because JSDOM has no paint engine.
 * nested-interactive is disabled because the row composition nests a
 * link inside a clickable row (same rationale as transactions-list.axe).
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    number: (n: number) => String(n),
    dateTime: (d: Date, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", opts).format(d),
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock(
  "@/components/billing/transactions/use-transactions-load-more",
  () => ({
    useTransactionsLoadMore: () => undefined,
  }),
);

vi.mock("@/convex/_generated/api", () => ({
  api: { credits: { queries: { listTransactionsPaginated: "stub" as const } } },
}));

type Doc = {
  _id: string;
  _creationTime: number;
  amount: number;
  balanceAfter: number;
  creditType: "free" | "paid";
  createdAt: number;
  type: "purchase" | "usage" | "grant" | "refund" | "expiry";
  billingType?: "embedding" | "extraction_llm" | "screening" | "chat";
  description?: string;
  metadata?: Record<string, string>;
};

function mkDoc(i: number, overrides: Partial<Doc> = {}): Doc {
  const type: Doc["type"] =
    (["purchase", "usage", "grant", "refund"] as const)[i % 4];
  return {
    _id: `tx-${i}`,
    _creationTime: Date.UTC(2026, 3, 20 - i, 10),
    amount: type === "usage" ? -(50 + i) : 100 + i,
    balanceAfter: 1000 - i * 10,
    creditType: i % 2 === 0 ? "paid" : "free",
    createdAt: Date.UTC(2026, 3, 20 - i, 10),
    type,
    description: `Row ${i}`,
    metadata: {},
    ...overrides,
  };
}

const today = Date.now();
const yesterday = today - 24 * 60 * 60 * 1000;
const older = Date.UTC(2025, 10, 15, 10);

const docs: Doc[] = [
  mkDoc(0, { createdAt: today }),
  mkDoc(1, { createdAt: today }),
  mkDoc(2, { createdAt: today }),
  mkDoc(3, { createdAt: yesterday }),
  mkDoc(4, { createdAt: yesterday }),
  mkDoc(5, { createdAt: yesterday }),
  mkDoc(6, { createdAt: older }),
  mkDoc(7, { createdAt: older }),
  mkDoc(8, { createdAt: older }),
  mkDoc(9, { createdAt: older }),
];

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedPaginatedQuery: () => ({
    status: "Exhausted",
    results: docs,
    isLoading: false,
    isInitialLoading: false,
    hasLoadedFirstPage: true,
    isSettled: true,
    loadMore: vi.fn(),
  }),
}));

import { TransactionsPanelClient } from "@/components/billing/transactions/transactions-panel-client";

expect.extend(toHaveNoViolations);

const AXE_OPTIONS = {
  rules: {
    "color-contrast": { enabled: false },
    "nested-interactive": { enabled: false },
  },
};

describe("transactions-panel axe", () => {
  it("has zero axe violations with 10 grouped rows and a sticky header", async () => {
    const { container } = render(<TransactionsPanelClient />);
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
