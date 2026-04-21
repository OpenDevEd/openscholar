import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params
      ? `${key}:${Object.entries(params)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",")}`
      : key,
  useFormatter: () => ({
    number: (n: number) => String(n),
    dateTime: (d: Date, opts?: Intl.DateTimeFormatOptions) =>
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

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock(
  "@/components/billing/transactions/use-transactions-load-more",
  () => ({
    useTransactionsLoadMore: () => undefined,
  }),
);

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

let mockResult: {
  status: string;
  results: Doc[];
  isLoading: boolean;
  isInitialLoading: boolean;
  hasLoadedFirstPage: boolean;
  isSettled: boolean;
  loadMore: (n: number) => void;
};
const queryArgsLog: unknown[] = [];

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedPaginatedQuery: (_query: unknown, args: unknown) => {
    queryArgsLog.push(args);
    return mockResult;
  },
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

function withNuqs(node: React.ReactNode, searchParams = "") {
  return (
    <NuqsTestingAdapter searchParams={searchParams} hasMemory>
      {node}
    </NuqsTestingAdapter>
  );
}

beforeEach(() => {
  routerReplace.mockReset();
  queryArgsLog.length = 0;
  setResult({});
});

describe("TransactionsPanelClient URL state integration", () => {
  it("forwards types/from/to from the URL into the paginated query args", () => {
    const fromIso = new Date("2026-04-01T00:00:00Z").toISOString();
    const toIso = new Date("2026-04-20T00:00:00Z").toISOString();
    setResult({ status: "Exhausted", results: [] });
    render(
      withNuqs(
        <TransactionsPanelClient />,
        `?types=purchase&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
      ),
    );
    const last = queryArgsLog[queryArgsLog.length - 1] as {
      types?: string[];
      from?: number;
      to?: number;
    };
    expect(last.types).toEqual(["purchase"]);
    expect(last.from).toBe(new Date(fromIso).getTime());
    expect(last.to).toBe(new Date(toIso).getTime());
  });

  it("does not forward types/from/to when the URL is empty (sends undefined)", () => {
    setResult({ status: "Exhausted", results: [] });
    render(withNuqs(<TransactionsPanelClient />));
    const last = queryArgsLog[queryArgsLog.length - 1] as {
      types?: string[];
      from?: number;
      to?: number;
    };
    expect(last.types).toBeUndefined();
    expect(last.from).toBeUndefined();
    expect(last.to).toBeUndefined();
  });

  it("client-side creditPool filter narrows the rendered rows without changing the loaded set", () => {
    setResult({
      status: "Exhausted",
      results: [
        mkDoc(0, { creditType: "paid" }),
        mkDoc(1, { creditType: "free" }),
        mkDoc(2, { creditType: "paid" }),
      ],
    });
    const { container } = render(
      withNuqs(<TransactionsPanelClient />, "?creditPools=paid"),
    );
    const rows = container.querySelectorAll("[data-txn-row]");
    expect(rows.length).toBe(2);
  });

  it("date sort defaults render group headers; switching sort to amount collapses groups", () => {
    const today = Date.now();
    const olderMs = Date.UTC(2025, 10, 15, 10);
    setResult({
      status: "Exhausted",
      results: [
        mkDoc(0, { createdAt: today, amount: 50 }),
        mkDoc(1, { createdAt: olderMs, amount: 30 }),
      ],
    });

    const { container: dateContainer } = render(
      withNuqs(<TransactionsPanelClient />),
    );
    expect(
      dateContainer.querySelectorAll("[data-transactions-group-header]").length,
    ).toBeGreaterThan(0);

    const { container: amountContainer } = render(
      withNuqs(<TransactionsPanelClient />, "?sort=amount&sortDir=asc"),
    );
    expect(
      amountContainer.querySelectorAll("[data-transactions-group-header]").length,
    ).toBe(0);
  });

  it("density from URL flows onto the panel's data-transactions-density attribute", () => {
    setResult({ status: "Exhausted", results: [mkDoc(0)] });
    const { container } = render(
      withNuqs(<TransactionsPanelClient />, "?density=spacious"),
    );
    const panel = container.querySelector("[data-transactions-panel]")!;
    expect(panel.getAttribute("data-transactions-density")).toBe("spacious");
  });

  it("renders exactly one aria-live region (the panel-level live summary)", () => {
    setResult({ status: "Exhausted", results: [mkDoc(0)] });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    const liveRegions = container.querySelectorAll("[aria-live]");
    expect(liveRegions.length).toBe(1);
    const live = liveRegions[0];
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.hasAttribute("data-transactions-live-summary")).toBe(true);
  });

  it("aria-live region populates the 'Showing N of M transactions' message after 500ms", async () => {
    vi.useFakeTimers();
    try {
      setResult({
        status: "Exhausted",
        results: [mkDoc(0), mkDoc(1), mkDoc(2)],
      });
      const { container } = render(withNuqs(<TransactionsPanelClient />));
      const live = container.querySelector(
        "[data-transactions-live-summary]",
      )!;
      expect(live.textContent).toBe("");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(live.textContent).toContain("live.summary");
      expect(live.textContent).toContain("shown=3");
      expect(live.textContent).toContain("total=3");
    } finally {
      vi.useRealTimers();
    }
  });

  it("toolbar + tabs render above the rows list (smoke)", () => {
    setResult({ status: "Exhausted", results: [mkDoc(0)] });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    expect(
      container.querySelector("[data-transactions-toolbar]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-transactions-tabs]"),
    ).not.toBeNull();
  });

  it("typing in the search input updates state.q and toggles data-search-deferred during the deferred frame", async () => {
    const user = userEvent.setup();
    setResult({
      status: "Exhausted",
      results: [
        mkDoc(0, { description: "alpha" }),
        mkDoc(1, { description: "beta" }),
      ],
    });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    const input = container.querySelector(
      "[data-transactions-search]",
    )! as HTMLInputElement;
    await user.type(input, "alpha");
    await waitFor(() => {
      expect(input.value).toBe("alpha");
    });
    // Eventually the deferred value catches up; data-search-deferred
    // settles to "false" once the predicate has applied.
    await waitFor(() => {
      const list = container.querySelector("[data-transactions-list]")!;
      expect(list.getAttribute("data-search-deferred")).toBe("false");
    });
    const rows = container.querySelectorAll("[data-txn-row]");
    expect(rows.length).toBe(1);
  });
});
