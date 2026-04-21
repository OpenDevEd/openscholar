import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

function withNuqs(node: React.ReactNode, searchParams: string = "") {
  return <NuqsTestingAdapter searchParams={searchParams}>{node}</NuqsTestingAdapter>;
}

// next/intl ----------------------------------------------------------------
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    number: (n: number) => String(n),
    dateTime: (d: Date, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", opts).format(d),
  }),
}));

// next/link ---------------------------------------------------------------
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

// next/navigation ---------------------------------------------------------
const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The IO hook is covered by its own unit test suite; no-op here.
vi.mock(
  "@/components/billing/transactions/use-transactions-load-more",
  () => ({
    useTransactionsLoadMore: () => undefined,
  }),
);

// Protected paginated query stub ------------------------------------------
type PaginatedStatus =
  | "LoadingFirstPage"
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted"
  | "Deferred";

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
  jobId?: string;
  paperId?: string;
  resultId?: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeCheckoutSessionId?: string;
  metadata?: Record<string, string>;
};

let mockResult: {
  status: PaginatedStatus;
  results: Doc[];
  isLoading: boolean;
  isInitialLoading: boolean;
  hasLoadedFirstPage: boolean;
  isSettled: boolean;
  loadMore: (n: number) => void;
};

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedPaginatedQuery: () => mockResult,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { credits: { queries: { listTransactionsPaginated: "stub" as const } } },
}));

import { TransactionsPanelClient } from "@/components/billing/transactions/transactions-panel-client";

function mkDoc(i: number, overrides: Partial<Doc> = {}): Doc {
  return {
    _id: `tx-${i}`,
    _creationTime: Date.UTC(2026, 3, 20 - i, 10),
    amount: 100,
    balanceAfter: 1000,
    creditType: "paid",
    createdAt: Date.UTC(2026, 3, 20 - i, 10),
    type: "purchase",
    description: `Row ${i}`,
    metadata: {},
    ...overrides,
  };
}

function setResult(partial: Partial<typeof mockResult>) {
  mockResult = {
    status: "Exhausted",
    results: [],
    isLoading: false,
    isInitialLoading: false,
    hasLoadedFirstPage: true,
    isSettled: true,
    loadMore: vi.fn(),
    ...partial,
  };
}

describe("TransactionsPanelClient", () => {
  beforeEach(() => {
    routerReplace.mockReset();
    setResult({});
  });

  it("renders the skeleton while the query is not settled yet", () => {
    setResult({
      status: "LoadingFirstPage",
      isInitialLoading: true,
      hasLoadedFirstPage: false,
      isSettled: false,
    });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    expect(
      container.querySelector("[data-transactions-skeleton]"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("[data-transactions-empty]"),
    ).toBeNull();
  });

  it("reflects the paginated status via data-transactions-status", () => {
    setResult({ status: "CanLoadMore", results: [mkDoc(0)] });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    expect(
      container
        .querySelector("[data-transactions-panel]")!
        .getAttribute("data-transactions-status"),
    ).toBe("CanLoadMore");
  });

  it("renders the empty state when settled with zero rows", () => {
    setResult({ status: "Exhausted", results: [], isSettled: true });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    expect(
      container
        .querySelector("[data-transactions-empty]")!
        .getAttribute("data-transactions-empty"),
    ).toBe("true");
    expect(
      container.querySelector("[data-transactions-skeleton]"),
    ).toBeNull();
  });

  it("renders a jobId-scoped empty state when settled with a jobId filter", () => {
    setResult({ status: "Exhausted", results: [], isSettled: true });
    render(withNuqs(<TransactionsPanelClient jobId={"job-123" as never} />));
    expect(screen.getByText("emptyForJob")).toBeInTheDocument();
  });

  it("reflects the jobId filter via data-transactions-filter", () => {
    setResult({ status: "Exhausted", results: [mkDoc(0)] });
    const { container } = render(
      withNuqs(<TransactionsPanelClient jobId={"job-xyz" as never} />),
    );
    expect(
      container
        .querySelector("[data-transactions-panel]")!
        .getAttribute("data-transactions-filter"),
    ).toBe("job-xyz");
  });

  it("renders grouped date-bucket headers when rows span today + yesterday + older", () => {
    const now = new Date();
    const todayMs = now.getTime();
    const yesterdayMs = todayMs - 24 * 60 * 60 * 1000;
    const olderMs = Date.UTC(2025, 10, 15, 10); // 2025-11-15
    setResult({
      status: "Exhausted",
      results: [
        mkDoc(0, { createdAt: todayMs }),
        mkDoc(1, { createdAt: yesterdayMs }),
        mkDoc(2, { createdAt: olderMs }),
      ],
    });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    const keys = [
      ...container.querySelectorAll("[data-transactions-group-header]"),
    ].map((el) => el.getAttribute("data-transactions-group-header"));
    expect(keys).toContain("today");
    expect(keys).toContain("yesterday");
    expect(keys.some((k) => k?.startsWith("month-2025-11"))).toBe(true);
  });

  it("renders a LoadingMore banner only when status === LoadingMore", () => {
    setResult({
      status: "LoadingMore",
      results: [mkDoc(0)],
    });
    const { container, rerender } = render(withNuqs(<TransactionsPanelClient />));
    expect(
      container.querySelector("[data-transactions-loading-more]"),
    ).toBeInTheDocument();

    setResult({
      status: "CanLoadMore",
      results: [mkDoc(0)],
    });
    rerender(withNuqs(<TransactionsPanelClient />));
    expect(
      container.querySelector("[data-transactions-loading-more]"),
    ).toBeNull();
  });

  it("renders the exhausted footer only when Exhausted AND rows exist", () => {
    setResult({ status: "Exhausted", results: [mkDoc(0)] });
    const { container, rerender } = render(withNuqs(<TransactionsPanelClient />));
    expect(
      container
        .querySelector("[data-transactions-exhausted]")!
        .getAttribute("data-transactions-exhausted"),
    ).toBe("true");

    setResult({ status: "Exhausted", results: [] });
    rerender(withNuqs(<TransactionsPanelClient />));
    expect(
      container.querySelector("[data-transactions-exhausted]"),
    ).toBeNull();
  });

  it("always renders a single IntersectionObserver sentinel with aria-hidden", () => {
    setResult({ status: "CanLoadMore", results: [mkDoc(0)] });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    const sentinel = container.querySelector("[data-transactions-sentinel]")!;
    expect(sentinel.getAttribute("aria-hidden")).toBe("true");
  });

  it("surfaces the summary with +in / −out / Net on the header region", () => {
    setResult({
      status: "Exhausted",
      results: [
        mkDoc(0, { amount: 100 }),
        mkDoc(1, { amount: 50 }),
        mkDoc(2, { amount: -30, type: "usage" }),
      ],
    });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    const summary = container.querySelector("[data-transactions-summary]")!;
    expect(summary.getAttribute("data-transactions-in")).toBe("150");
    expect(summary.getAttribute("data-transactions-out")).toBe("30");
    expect(summary.getAttribute("data-transactions-net")).toBe("120");
  });

  it("keeps exactly one aria-live region in the panel", () => {
    setResult({
      status: "LoadingMore",
      results: [mkDoc(0)],
    });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    const liveRegions = container.querySelectorAll('[aria-live]');
    expect(liveRegions.length).toBe(1);
    expect(liveRegions[0].getAttribute("aria-live")).toBe("polite");
  });
});
