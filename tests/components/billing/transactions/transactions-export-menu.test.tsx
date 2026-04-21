/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TransactionsExportMenu } from "@/components/billing/transactions/transactions-export-menu";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params
      ? `${key}:${Object.entries(params)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",")}`
      : key,
}));

function row(
  overrides: Partial<TransactionViewModel> & { id: string },
): TransactionViewModel {
  return {
    type: "purchase",
    creditType: "paid",
    billingType: null,
    direction: "in",
    amount: 100,
    signedAmount: 100,
    balanceAfter: 1000,
    description: null,
    createdAt: 0,
    jobId: null,
    paperId: null,
    resultId: null,
    stripeInvoiceId: null,
    stripePaymentIntentId: null,
    stripeChargeId: null,
    stripeCheckoutSessionId: null,
    metadata: {},
    hasStripe: false,
    paperTitle: null,
    jobName: null,
    openalexRef: null,
    modelLabel: null,
    tokenSummary: null,
    ...overrides,
  };
}

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let anchorClicks: string[] = [];

beforeEach(() => {
  anchorClicks = [];
  createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
  revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (tagName: string) => {
      const el = origCreate(tagName) as HTMLElement;
      if (tagName.toLowerCase() === "a") {
        (el as HTMLAnchorElement).click = () => {
          anchorClicks.push((el as HTMLAnchorElement).download);
        };
      }
      return el;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function openMenu(trigger: HTMLElement) {
  const user = userEvent.setup();
  await user.click(trigger);
  return user;
}

describe("TransactionsExportMenu", () => {
  it("tags the 'Current view' item with aria-disabled when currentView is empty", async () => {
    const { container } = render(
      <TransactionsExportMenu
        currentView={[]}
        fetchAll={vi.fn().mockResolvedValue([])}
      />,
    );
    const trigger = container.querySelector(
      "[data-transactions-export-trigger]",
    ) as HTMLElement;
    await openMenu(trigger);
    const current = await waitFor(() =>
      document.querySelector("[data-export-mode='current']"),
    );
    expect(current?.getAttribute("aria-disabled")).toBe("true");
  });

  it("exports current view with a dated filename on click", async () => {
    const rows = [row({ id: "r1" }), row({ id: "r2" })];
    const fetchAll = vi.fn().mockResolvedValue([]);
    const { container } = render(
      <TransactionsExportMenu currentView={rows} fetchAll={fetchAll} />,
    );
    const trigger = container.querySelector(
      "[data-transactions-export-trigger]",
    ) as HTMLElement;
    const user = await openMenu(trigger);
    const current = await waitFor(
      () => document.querySelector("[data-export-mode='current']") as HTMLElement,
    );
    await user.click(current);
    await waitFor(() => expect(anchorClicks.length).toBe(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClicks[0]).toMatch(/^transactions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it("drains fetchAll and writes transactions-all-{date}.csv", async () => {
    const rows = [row({ id: "current" })];
    const allRows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    const fetchAll = vi.fn().mockResolvedValue(allRows);
    const { container } = render(
      <TransactionsExportMenu currentView={rows} fetchAll={fetchAll} />,
    );
    const trigger = container.querySelector(
      "[data-transactions-export-trigger]",
    ) as HTMLElement;
    const user = await openMenu(trigger);
    const all = await waitFor(
      () => document.querySelector("[data-export-mode='all']") as HTMLElement,
    );
    await user.click(all);
    await waitFor(() => expect(fetchAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(anchorClicks.length).toBe(1));
    expect(anchorClicks[0]).toMatch(
      /^transactions-all-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });

  it("toggles data-transactions-export-loading while fetchAll is in flight", async () => {
    const rows = [row({ id: "r1" })];
    let resolveAll!: (v: readonly TransactionViewModel[]) => void;
    const fetchAll = vi.fn(
      () =>
        new Promise<readonly TransactionViewModel[]>((r) => {
          resolveAll = r;
        }),
    );
    const { container } = render(
      <TransactionsExportMenu currentView={rows} fetchAll={fetchAll} />,
    );
    const trigger = container.querySelector(
      "[data-transactions-export-trigger]",
    ) as HTMLElement;
    const user = await openMenu(trigger);
    const all = await waitFor(
      () => document.querySelector("[data-export-mode='all']") as HTMLElement,
    );
    await user.click(all);

    await waitFor(() =>
      expect(
        container
          .querySelector("[data-transactions-export-trigger]")!
          .getAttribute("data-transactions-export-loading"),
      ).toBe("true"),
    );

    resolveAll([]);

    await waitFor(() =>
      expect(
        container
          .querySelector("[data-transactions-export-trigger]")!
          .getAttribute("data-transactions-export-loading"),
      ).toBeNull(),
    );
  });

  it("re-enables the trigger if fetchAll rejects", async () => {
    const rows = [row({ id: "r1" })];
    const fetchAll = vi.fn().mockRejectedValue(new Error("network"));
    const { container } = render(
      <TransactionsExportMenu currentView={rows} fetchAll={fetchAll} />,
    );
    const trigger = container.querySelector(
      "[data-transactions-export-trigger]",
    ) as HTMLElement;
    const user = await openMenu(trigger);
    const all = await waitFor(
      () => document.querySelector("[data-export-mode='all']") as HTMLElement,
    );
    // The rejection propagates out of the click-bound handler — swallow it so
    // the assertion below runs.
    await user.click(all).catch(() => undefined);

    await waitFor(() => expect(fetchAll).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        container
          .querySelector("[data-transactions-export-trigger]")!
          .getAttribute("data-transactions-export-loading"),
      ).toBeNull(),
    );
  });
});
