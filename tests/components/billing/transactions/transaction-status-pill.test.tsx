import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TransactionStatusPill } from "@/components/billing/transactions/transaction-status-pill";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("TransactionStatusPill", () => {
  it("renders role='status' so screen readers announce state changes", () => {
    render(<TransactionStatusPill status="pending" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("exposes data-txn-status-pill='pending' for pending state", () => {
    const { container } = render(<TransactionStatusPill status="pending" />);
    const pill = container.querySelector("[data-txn-status-pill]");
    expect(pill?.getAttribute("data-txn-status-pill")).toBe("pending");
  });

  it("exposes data-txn-status-pill='failed' for failed state", () => {
    const { container } = render(<TransactionStatusPill status="failed" />);
    const pill = container.querySelector("[data-txn-status-pill]");
    expect(pill?.getAttribute("data-txn-status-pill")).toBe("failed");
  });

  it("exposes data-txn-status-pill='expired' for expired state", () => {
    const { container } = render(<TransactionStatusPill status="expired" />);
    const pill = container.querySelector("[data-txn-status-pill]");
    expect(pill?.getAttribute("data-txn-status-pill")).toBe("expired");
  });

  it("renders the localized status key as visible text", () => {
    render(<TransactionStatusPill status="pending" />);
    expect(screen.getByRole("status").textContent).toBe("pending");
  });
});
