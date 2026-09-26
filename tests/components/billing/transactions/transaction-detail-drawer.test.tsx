/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithTooltip as render } from "../../../helpers/render-with-tooltip";
import userEvent from "@testing-library/user-event";

import { TransactionDetailDrawer } from "@/components/billing/transactions/transaction-detail-drawer";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params
      ? `${key}:${Object.entries(params)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",")}`
      : key,
  useFormatter: () => ({
    number: (n: number) => String(n),
    dateTime: (d: Date) => d.toISOString(),
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

function makeRow(
  overrides: Partial<TransactionViewModel> = {},
): TransactionViewModel {
  return {
    id: "tx-1",
    type: "purchase",
    creditType: "paid",
    billingType: null,
    direction: "in",
    amount: 1240,
    signedAmount: 1240,
    description: "Top-up 1,240 credits",
    createdAt: Date.UTC(2026, 3, 20, 10, 0, 0),
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

describe("TransactionDetailDrawer", () => {
  it("renders nothing when row is null", () => {
    render(<TransactionDetailDrawer row={null} onOpenChange={vi.fn()} />);
    expect(
      document.querySelector("[data-transaction-drawer]"),
    ).toBeNull();
  });

  it("opens with data-transaction-drawer and carries data-transaction-id", () => {
    render(
      <TransactionDetailDrawer row={makeRow()} onOpenChange={vi.fn()} />,
    );
    const drawer = document.querySelector("[data-transaction-drawer]");
    expect(drawer).not.toBeNull();
    expect(drawer?.getAttribute("data-transaction-id")).toBe("tx-1");
  });

  it("title goes through resolveTitle — grant packs amount into titles.freeCredits", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({ description: null, type: "grant", amount: 500 })}
        onOpenChange={vi.fn()}
      />,
    );
    const title = screen.getByRole("heading", { level: 2 });
    expect(title.textContent).toBe("titles.freeCredits:amount=500");
  });

  it("title prefers paperTitle for usage:screening rows (NOT the description)", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({
          type: "usage",
          billingType: "screening",
          description: "Bulk screening",
          paperTitle: "Attention Is All You Need",
        })}
        onOpenChange={vi.fn()}
      />,
    );
    const title = screen.getByRole("heading", { level: 2 });
    expect(title.textContent).toBe("Attention Is All You Need");
  });

  it("title falls back to service label when billingType is typed but no titles are known", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({
          type: "usage",
          billingType: "search",
          description: "AI: Enhance search query",
          paperTitle: null,
          jobName: null,
          openalexRef: null,
        })}
        onOpenChange={vi.fn()}
      />,
    );
    const title = screen.getByRole("heading", { level: 2 });
    // Service-fallback, NOT the "AI: Enhance search query" description.
    expect(title.textContent).toBe("titles.search");
  });

  it("title uses wallet_api model-packed key when modelLabel is present", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({
          type: "usage",
          billingType: "wallet_api",
          description: "Wallet API: GPT 4o Mini",
          modelLabel: "GPT 4o Mini",
        })}
        onOpenChange={vi.fn()}
      />,
    );
    const title = screen.getByRole("heading", { level: 2 });
    expect(title.textContent).toBe("titles.walletApi:model=GPT 4o Mini");
  });

  it("renders the signed amount with + for credits", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({ direction: "in", amount: 500 })}
        onOpenChange={vi.fn()}
      />,
    );
    const amount = document.querySelector("[data-drawer-amount]");
    expect(amount?.getAttribute("data-direction")).toBe("in");
    expect(amount?.textContent).toBe("+500");
  });

  it("uses U+2212 minus for debits, not ASCII hyphen", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({ direction: "out", amount: 200 })}
        onOpenChange={vi.fn()}
      />,
    );
    const amount = document.querySelector("[data-drawer-amount]");
    expect(amount?.textContent).toBe("−200");
    expect(amount?.textContent?.startsWith("-")).toBe(false);
  });

  it("renders credit-pool + type badges with data-value attributes", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({ creditType: "free", type: "grant" })}
        onOpenChange={vi.fn()}
      />,
    );
    const pool = document.querySelector(
      "[data-drawer-badge='credit-pool']",
    );
    const type = document.querySelector("[data-drawer-badge='type']");
    expect(pool?.getAttribute("data-value")).toBe("free");
    expect(type?.getAttribute("data-value")).toBe("grant");
  });

  it("omits the billing-type badge when billingType is null", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({ billingType: null })}
        onOpenChange={vi.fn()}
      />,
    );
    expect(
      document.querySelector("[data-drawer-badge='billing-type']"),
    ).toBeNull();
  });

  it("renders the billing-type badge when billingType is set", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({ billingType: "extraction_llm" })}
        onOpenChange={vi.fn()}
      />,
    );
    const badge = document.querySelector(
      "[data-drawer-badge='billing-type']",
    );
    expect(badge?.getAttribute("data-value")).toBe("extraction_llm");
  });

  it("mounts the Stripe section when any Stripe id is set", () => {
    render(
      <TransactionDetailDrawer
        row={makeRow({
          stripeInvoiceId: "in_abc",
          hasStripe: true,
        })}
        onOpenChange={vi.fn()}
      />,
    );
    expect(
      document.querySelector("[data-drawer-section='stripe']"),
    ).not.toBeNull();
  });

  it("omits the Stripe section when hasStripe is false", () => {
    render(
      <TransactionDetailDrawer row={makeRow()} onOpenChange={vi.fn()} />,
    );
    expect(document.querySelector("[data-drawer-section='stripe']")).toBeNull();
  });

  it("mounts the metadata section only when metadata has keys", () => {
    const { rerender } = render(
      <TransactionDetailDrawer
        row={makeRow({ metadata: {} })}
        onOpenChange={vi.fn()}
      />,
    );
    expect(
      document.querySelector("[data-drawer-section='metadata']"),
    ).toBeNull();

    rerender(
      <TransactionDetailDrawer
        row={makeRow({ metadata: { source: "stripe-webhook" } })}
        onOpenChange={vi.fn()}
      />,
    );
    expect(
      document.querySelector("[data-drawer-section='metadata']"),
    ).not.toBeNull();
  });

  it("calls onOpenChange(false) when the close button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <TransactionDetailDrawer
        row={makeRow()}
        onOpenChange={onOpenChange}
      />,
    );
    const close = document.querySelector("[data-drawer-close]") as HTMLElement;
    fireEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when Escape is pressed", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TransactionDetailDrawer
        row={makeRow()}
        onOpenChange={onOpenChange}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
