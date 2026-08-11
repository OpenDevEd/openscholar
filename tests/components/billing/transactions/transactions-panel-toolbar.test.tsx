import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: (d: Date) => d.toISOString().slice(0, 10),
    number: (n: number) => String(n),
  }),
}));

import { TransactionsPanelToolbar } from "@/components/billing/transactions/transactions-panel-toolbar";

interface RenderOpts {
  searchParams?: string;
  counts?: Record<string, number>;
  onUrlUpdate?: (event: { searchParams: URLSearchParams }) => void;
}

function renderToolbar({
  searchParams = "",
  counts = {},
  onUrlUpdate,
}: RenderOpts = {}) {
  return render(
    <NuqsTestingAdapter
      searchParams={searchParams}
      onUrlUpdate={onUrlUpdate}
    >
      <TransactionsPanelToolbar counts={counts} />
    </NuqsTestingAdapter>,
  );
}

beforeEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

describe("TransactionsPanelToolbar", () => {
  it("data-transactions-filter-active is 'false' on a fresh URL", () => {
    const { container } = renderToolbar();
    const root = container.querySelector("[data-transactions-toolbar]")!;
    expect(root.getAttribute("data-transactions-filter-active")).toBe("false");
  });

  it("data-transactions-filter-active flips to 'true' when types is non-empty", () => {
    const { container } = renderToolbar({
      searchParams: "?types=purchase",
    });
    const root = container.querySelector("[data-transactions-toolbar]")!;
    expect(root.getAttribute("data-transactions-filter-active")).toBe("true");
  });

  it("Clear-all button is hidden when no filter is active", () => {
    const { container } = renderToolbar();
    expect(container.querySelector("[data-transactions-clear-all]")).toBeNull();
  });

  it("Clear-all button appears once any filter is active and clears the URL when clicked", async () => {
    const user = userEvent.setup();
    const updates: URLSearchParams[] = [];
    const { container } = renderToolbar({
      searchParams: "?q=hello&types=purchase",
      onUrlUpdate: (event) => updates.push(event.searchParams),
    });
    const clearAll = container.querySelector(
      "[data-transactions-clear-all]",
    )! as HTMLButtonElement;
    expect(clearAll).not.toBeNull();
    await user.click(clearAll);
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    const last = updates[updates.length - 1];
    expect(last.get("q")).toBeNull();
    expect(last.get("types")).toBeNull();
    expect(last.get("view")).toBeNull();
  });

  it("typing in the search input writes q to the URL", async () => {
    const user = userEvent.setup();
    const updates: URLSearchParams[] = [];
    const { container } = renderToolbar({
      onUrlUpdate: (event) => updates.push(event.searchParams),
    });
    const search = container.querySelector(
      "[data-transactions-search]",
    )! as HTMLInputElement;
    await user.type(search, "abc");
    await waitFor(() => {
      expect(updates.some((u) => u.get("q") === "abc")).toBe(true);
    });
  });

  it("search clear button is hidden when q is empty and visible when q is set", () => {
    const { container: emptyContainer } = renderToolbar();
    expect(
      emptyContainer.querySelector("[data-transactions-search-clear]"),
    ).toBeNull();
    const { container: filledContainer } = renderToolbar({
      searchParams: "?q=hello",
    });
    expect(
      filledContainer.querySelector("[data-transactions-search-clear]"),
    ).not.toBeNull();
  });

  it("billing-type filter is hidden when usage is not in types and shown otherwise", () => {
    const { container: hiddenContainer } = renderToolbar({
      searchParams: "?types=purchase",
    });
    expect(
      hiddenContainer.querySelector('[data-filter-multi-select="billingType"]'),
    ).toBeNull();
    const { container: shownContainer } = renderToolbar({
      searchParams: "?types=usage",
    });
    expect(
      shownContainer.querySelector('[data-filter-multi-select="billingType"]'),
    ).not.toBeNull();
    const { container: emptyContainer } = renderToolbar();
    expect(
      emptyContainer.querySelector('[data-filter-multi-select="billingType"]'),
    ).not.toBeNull();
  });

  it("sort trigger surfaces sort + dir via data attributes that match the URL", () => {
    const { container } = renderToolbar({
      searchParams: "?sort=amount&sortDir=asc",
    });
    const trigger = container.querySelector(
      "[data-transactions-sort-trigger]",
    )!;
    expect(trigger.getAttribute("data-sort-field")).toBe("amount");
    expect(trigger.getAttribute("data-sort-dir")).toBe("asc");
  });

  it("density trigger surfaces the active density via data attribute", () => {
    const { container } = renderToolbar({
      searchParams: "?density=compact",
    });
    const trigger = container.querySelector(
      "[data-transactions-density-trigger]",
    )!;
    expect(trigger.getAttribute("data-density")).toBe("compact");
  });

  it("changing density mirrors the choice to localStorage", async () => {
    const user = userEvent.setup();
    const { container } = renderToolbar();
    const trigger = container.querySelector(
      "[data-transactions-density-trigger]",
    )! as HTMLElement;
    await user.click(trigger);
    const compact = await screen.findByRole("menuitemradio", {
      name: "density.compact",
    });
    await user.click(compact);
    await waitFor(() =>
      expect(window.localStorage.getItem("billing.transactions.density")).toBe(
        "compact",
      ),
    );
  });

  it("multi-select counts are wired from the counts prop", async () => {
    const user = userEvent.setup();
    const { container } = renderToolbar({
      counts: {
        "type:purchase": 14,
        "type:usage": 9,
        "type:grant": 0,
        "type:refund": 0,
        "type:expiry": 0,
      },
    });
    await user.click(
      container.querySelector(
        '[data-filter-multi-select="type"]',
      )! as HTMLElement,
    );
    const purchaseOption = await screen.findByRole("option", {
      name: /purchase/i,
    });
    expect(purchaseOption.textContent).toContain("14");
    const usageOption = await screen.findByRole("option", {
      name: /^usage/i,
    });
    expect(usageOption.textContent).toContain("9");
  });
});
