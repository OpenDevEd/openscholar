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
  useProtectedQuery: () => ({
    data: {
      type: { purchase: 0, usage: 0, grant: 0, refund: 0, expiry: 0 },
      creditPool: { free: 0, paid: 0 },
      billingType: {
        extraction_llm: 0,
        embedding: 0,
        screening: 0,
        chat: 0,
        search: 0,
        translation: 0,
        wallet_api: 0,
      },
    },
    phase: "authenticated",
    isDeferred: false,
    isReady: true,
    isAnonymous: false,
    settlement: "ready",
  }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    credits: {
      queries: {
        listTransactionsPaginated: "stub" as const,
        getTransactionFacetCounts: "stub-counts" as const,
      },
    },
  },
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

  it("renders the no-data empty state when settled with zero rows and no filters", () => {
    setResult({ status: "Exhausted", results: [], isSettled: true });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    expect(
      container
        .querySelector("[data-transactions-empty]")!
        .getAttribute("data-transactions-empty"),
    ).toBe("no-data");
    expect(
      container.querySelector("[data-transactions-skeleton]"),
    ).toBeNull();
  });

  it("renders a no-matches empty state when a jobId scope is active and zero rows", () => {
    setResult({ status: "Exhausted", results: [], isSettled: true });
    const { container } = render(
      withNuqs(<TransactionsPanelClient jobId={"job-123" as never} />),
    );
    const empty = container.querySelector("[data-transactions-empty]")!;
    expect(empty.getAttribute("data-transactions-empty")).toBe("no-matches");
    expect(
      container.querySelector("[data-transactions-empty-clear]"),
    ).toBeInTheDocument();
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

  it("drives loadMore automatically when status is CanLoadMore with zero rows", () => {
    // Filters that match zero rows can't rely on the IntersectionObserver
    // sentinel (zero height + implementation-defined initial-check) to
    // progress the filter().paginate() walk. The component must drive the
    // walk forward itself, otherwise the skeleton shows indefinitely.
    const loadMore = vi.fn();
    setResult({
      status: "CanLoadMore",
      results: [],
      isSettled: true,
      hasLoadedFirstPage: true,
      loadMore,
    });
    render(withNuqs(<TransactionsPanelClient />));
    expect(loadMore).toHaveBeenCalled();
    expect(loadMore.mock.calls[0][0]).toBeGreaterThan(25);
  });

  it("does not drive loadMore automatically when rows are already present", () => {
    const loadMore = vi.fn();
    setResult({
      status: "CanLoadMore",
      results: [mkDoc(0)],
      isSettled: true,
      hasLoadedFirstPage: true,
      loadMore,
    });
    render(withNuqs(<TransactionsPanelClient />));
    expect(loadMore).not.toHaveBeenCalled();
  });

  it("hides the LoadingMore banner when status is LoadingMore but rows are empty", () => {
    // Convex's filter().paginate() walks the index and emits status
    // LoadingMore with an empty page. That transient must not flash the
    // "loading more" banner alongside the empty state.
    setResult({
      status: "LoadingMore",
      results: [],
      isSettled: true,
      hasLoadedFirstPage: true,
    });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    expect(
      container.querySelector("[data-transactions-loading-more]"),
    ).toBeNull();
  });

  it("shows the skeleton (not empty, not loading-more) while paginating through empty filtered pages", () => {
    // Filters match zero rows but the index still needs to be walked.
    // status=CanLoadMore with rows=[] must render as "still loading" rather
    // than flickering between the empty state and the "loading more" banner.
    setResult({
      status: "CanLoadMore",
      results: [],
      isSettled: true,
      hasLoadedFirstPage: true,
    });
    const { container, rerender } = render(
      withNuqs(<TransactionsPanelClient />),
    );
    expect(
      container.querySelector("[data-transactions-skeleton]"),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-transactions-empty]")).toBeNull();
    expect(
      container.querySelector("[data-transactions-loading-more]"),
    ).toBeNull();

    // Same invariant while that walk is mid-fetch.
    setResult({
      status: "LoadingMore",
      results: [],
      isSettled: true,
      hasLoadedFirstPage: true,
    });
    rerender(withNuqs(<TransactionsPanelClient />));
    expect(
      container.querySelector("[data-transactions-skeleton]"),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-transactions-empty]")).toBeNull();
    expect(
      container.querySelector("[data-transactions-loading-more]"),
    ).toBeNull();

    // And once the server confirms there really is nothing, the empty
    // state takes over without any banner.
    setResult({
      status: "Exhausted",
      results: [],
      isSettled: true,
      hasLoadedFirstPage: true,
    });
    rerender(withNuqs(<TransactionsPanelClient />));
    expect(container.querySelector("[data-transactions-skeleton]")).toBeNull();
    expect(
      container.querySelector("[data-transactions-empty]"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("[data-transactions-loading-more]"),
    ).toBeNull();
  });

  it("does not render the removed in/out/net header summary", () => {
    setResult({
      status: "Exhausted",
      results: [
        mkDoc(0, { amount: 100 }),
        mkDoc(1, { amount: 50 }),
        mkDoc(2, { amount: -30, type: "usage" }),
      ],
    });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    expect(container.querySelector("[data-transactions-summary]")).toBeNull();
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

  it("never sets aria-live on the list container or any row", () => {
    setResult({
      status: "Exhausted",
      results: [mkDoc(0), mkDoc(1)],
    });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    expect(
      container
        .querySelector("[data-transactions-list]")
        ?.hasAttribute("aria-live"),
    ).toBe(false);
    container.querySelectorAll("[data-txn-row]").forEach((row) => {
      expect(row.hasAttribute("aria-live")).toBe(false);
    });
  });

  it("exposes aria-activedescendant on the list and flips data-txn-active on ArrowDown", async () => {
    setResult({
      status: "Exhausted",
      results: [mkDoc(0), mkDoc(1)],
    });
    const { container } = render(withNuqs(<TransactionsPanelClient />));
    const list = container.querySelector("[data-transactions-list]") as HTMLElement;
    expect(list).toBeInTheDocument();
    expect(list.getAttribute("aria-activedescendant")).toBeNull();
    list.focus();
    const { act } = await import("@testing-library/react");
    act(() => {
      list.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(list.getAttribute("aria-activedescendant")).toMatch(/^txn-row-/);
    const activeRow = container.querySelector('[data-txn-active="true"]');
    expect(activeRow).not.toBeNull();
  });

  it("renders the no-matches empty state with a clear button when filters drop everything", () => {
    setResult({ status: "Exhausted", results: [mkDoc(0, { type: "purchase" })] });
    const { container } = render(
      withNuqs(<TransactionsPanelClient />, "types=usage"),
    );
    const empty = container.querySelector("[data-transactions-empty]")!;
    expect(empty.getAttribute("data-transactions-empty")).toBe("no-matches");
    expect(
      container.querySelector("[data-transactions-empty-clear]"),
    ).toBeInTheDocument();
  });

  it("surfaces the inline error banner when the inner client throws on mount", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = mockResult;
    Object.defineProperty(mockResult, "results", {
      get() {
        throw new Error("boom");
      },
    });
    try {
      const { container } = render(withNuqs(<TransactionsPanelClient />));
      const alert = container.querySelector('[role="alert"]');
      expect(alert).toBeInTheDocument();
      expect(alert?.hasAttribute("data-transactions-error")).toBe(true);
      expect(
        container.querySelector("[data-transactions-error-retry]"),
      ).toBeInTheDocument();
    } finally {
      mockResult = original;
      spy.mockRestore();
    }
  });
});
