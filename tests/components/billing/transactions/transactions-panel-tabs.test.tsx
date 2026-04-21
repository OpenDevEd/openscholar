import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { TransactionsPanelTabs } from "@/components/billing/transactions/transactions-panel-tabs";
import { VIEW_TABS } from "@/components/billing/transactions/use-transactions-state";

function renderWithUrl(searchParams = "", onUrlUpdate?: (event: { searchParams: URLSearchParams; queryString: string }) => void) {
  return render(
    <NuqsTestingAdapter
      searchParams={searchParams}
      onUrlUpdate={onUrlUpdate}
      hasMemory
    >
      <TransactionsPanelTabs />
    </NuqsTestingAdapter>,
  );
}

describe("TransactionsPanelTabs", () => {
  it("renders one trigger per VIEW_TABS entry exposing data-transactions-tab", () => {
    const { container } = renderWithUrl();
    const triggers = container.querySelectorAll("[data-transactions-tab]");
    expect(triggers.length).toBe(VIEW_TABS.length);
    const values = Array.from(triggers).map((el) =>
      el.getAttribute("data-transactions-tab"),
    );
    expect(values).toEqual([...VIEW_TABS]);
  });

  it("activates the 'all' tab by default when no view param is in the URL", () => {
    const { container } = renderWithUrl();
    const all = container.querySelector('[data-transactions-tab="all"]')!;
    expect(all.getAttribute("data-state")).toBe("active");
  });

  it("activates the tab matching ?view= on first render", () => {
    const { container } = renderWithUrl("?view=purchases");
    const purchases = container.querySelector(
      '[data-transactions-tab="purchases"]',
    )!;
    expect(purchases.getAttribute("data-state")).toBe("active");
  });

  it("clicking a tab writes view + the matching types preset in one URL update", async () => {
    const user = userEvent.setup();
    const updates: URLSearchParams[] = [];
    const { container } = renderWithUrl("", (event) => {
      updates.push(event.searchParams);
    });
    const purchases = container.querySelector(
      '[data-transactions-tab="purchases"]',
    )! as HTMLElement;
    await user.click(purchases);

    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    const last = updates[updates.length - 1];
    expect(last.get("view")).toBe("purchases");
    expect(last.get("types")).toBe("purchase");
  });

  it("'all' tab clears types in the URL (default value drops)", async () => {
    const user = userEvent.setup();
    const updates: URLSearchParams[] = [];
    const { container } = renderWithUrl(
      "?view=purchases&types=purchase",
      (event) => {
        updates.push(event.searchParams);
      },
    );
    const all = container.querySelector(
      '[data-transactions-tab="all"]',
    )! as HTMLElement;
    await user.click(all);

    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    const last = updates[updates.length - 1];
    expect(last.get("view")).toBeNull();
    expect(last.get("types")).toBeNull();
  });
});
