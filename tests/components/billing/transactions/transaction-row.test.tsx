import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TransactionRow } from "@/components/billing/transactions/transaction-row";
import type { TransactionViewModel } from "@/lib/billing/transactions/transaction-view-model";

vi.mock("next-intl", () => ({
  useTranslations: () =>
    (key: string, values?: Record<string, string | number>) => {
      if (!values) return key;
      const suffix = Object.values(values).join(",");
      return `${key}|${suffix}`;
    },
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

function makeRow(overrides: Partial<TransactionViewModel> = {}): TransactionViewModel {
  return {
    id: "tx-123",
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

describe("TransactionRow", () => {
  it("exposes every behavioral data-* dimension on the row root", () => {
    const row = makeRow({
      id: "tx-xyz",
      type: "usage",
      direction: "out",
      creditType: "free",
      billingType: "embedding",
    });
    render(<TransactionRow row={row} density="comfortable" />);
    const el = screen.getByRole("listitem");
    expect(el.getAttribute("data-txn-id")).toBe("tx-xyz");
    expect(el.getAttribute("data-txn-type")).toBe("usage");
    expect(el.getAttribute("data-txn-direction")).toBe("out");
    expect(el.getAttribute("data-txn-credit-type")).toBe("free");
    expect(el.getAttribute("data-txn-billing-type")).toBe("embedding");
    expect(el.getAttribute("data-txn-status")).toBe("routine");
    expect(el.getAttribute("data-txn-density")).toBe("comfortable");
  });

  it("carries data-txn-status='expired' for expiry rows (D4)", () => {
    render(<TransactionRow row={makeRow({ type: "expiry" })} density="comfortable" />);
    expect(screen.getByRole("listitem").getAttribute("data-txn-status")).toBe(
      "expired",
    );
  });

  it("sets id='txn-row-{id}' for aria-activedescendant targeting", () => {
    render(<TransactionRow row={makeRow({ id: "tx-abc" })} density="comfortable" />);
    expect(screen.getByRole("listitem").id).toBe("txn-row-tx-abc");
  });

  it("carries an aria-label summarizing amount, direction, and date", () => {
    render(<TransactionRow row={makeRow({ type: "purchase", direction: "in" })} density="comfortable" />);
    const label = screen.getByRole("listitem").getAttribute("aria-label");
    expect(label).toMatch(/aria\.credit/);
    expect(label).toMatch(/1240/);
  });

  it("exposes data-txn-title-source so tests can pin the title branch without reading CSS", () => {
    const { rerender } = render(
      <TransactionRow
        row={makeRow({
          type: "usage",
          billingType: "screening",
          paperTitle: "Attention Is All You Need",
        })}
        density="comfortable"
      />,
    );
    expect(screen.getByRole("listitem").getAttribute("data-txn-title-source")).toBe(
      "paper-title",
    );
    rerender(
      <TransactionRow
        row={makeRow({ type: "purchase", direction: "in" })}
        density="comfortable"
      />,
    );
    expect(screen.getByRole("listitem").getAttribute("data-txn-title-source")).toBe(
      "purchase-packed",
    );
  });

  it("renders the paperTitle as the primary title when present (screening usage)", () => {
    const row = makeRow({
      type: "usage",
      billingType: "screening",
      paperTitle: "Attention Is All You Need",
    });
    const { container } = render(<TransactionRow row={row} density="comfortable" />);
    expect(container.querySelector("[data-txn-title]")?.textContent).toBe(
      "Attention Is All You Need",
    );
  });

  it("falls back to the packed type title when description / paperTitle are absent", () => {
    const row = makeRow({
      type: "purchase",
      direction: "in",
      description: null,
      paperTitle: null,
    });
    const { container } = render(<TransactionRow row={row} density="comfortable" />);
    expect(container.querySelector("[data-txn-title]")?.textContent).toMatch(
      /titles\.paidCredits/,
    );
  });

  it("omits the secondary line at density='compact'", () => {
    const row = makeRow({
      type: "usage",
      billingType: "embedding",
    });
    const { container } = render(<TransactionRow row={row} density="compact" />);
    expect(container.querySelector("[data-txn-secondary]")).toBeNull();
  });

  it("renders the secondary line at density='comfortable'", () => {
    const row = makeRow({
      type: "usage",
      billingType: "embedding",
    });
    const { container } = render(<TransactionRow row={row} density="comfortable" />);
    const sec = container.querySelector("[data-txn-secondary]");
    expect(sec).not.toBeNull();
    expect(sec?.textContent).toMatch(/billingType\.embedding/);
  });

  it("fires onClick with the row when the user clicks the row", () => {
    const spy = vi.fn();
    const row = makeRow();
    render(<TransactionRow row={row} density="comfortable" onClick={spy} />);
    fireEvent.click(screen.getByRole("listitem"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(row);
  });

  it("does NOT fire the row onClick when the hover-reveal link is clicked (stopPropagation)", () => {
    const spy = vi.fn();
    const row = makeRow({ type: "usage", jobId: "job-42" });
    render(<TransactionRow row={row} density="comfortable" onClick={spy} />);
    const link = screen.getByRole("link", { name: "actions.openJob" });
    fireEvent.click(link);
    expect(spy).not.toHaveBeenCalled();
  });

  it("renders the status pill only for non-routine statuses", () => {
    const { container: routine } = render(
      <TransactionRow row={makeRow()} density="comfortable" />,
    );
    expect(routine.querySelector("[data-txn-status-pill]")).toBeNull();

    const { container: expired } = render(
      <TransactionRow row={makeRow({ type: "expiry" })} density="comfortable" />,
    );
    expect(
      expired.querySelector("[data-txn-status-pill]")?.getAttribute("data-txn-status-pill"),
    ).toBe("expired");
  });

  it("sets data-txn-active only when isActive is true", () => {
    const { rerender } = render(
      <TransactionRow row={makeRow()} density="comfortable" isActive={false} />,
    );
    expect(screen.getByRole("listitem").hasAttribute("data-txn-active")).toBe(false);
    rerender(<TransactionRow row={makeRow()} density="comfortable" isActive />);
    expect(screen.getByRole("listitem").getAttribute("data-txn-active")).toBe("true");
  });
});
