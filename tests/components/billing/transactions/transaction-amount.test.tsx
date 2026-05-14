import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { TransactionAmount } from "@/components/billing/transactions/transaction-amount";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    number: (n: number) => String(n),
  }),
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === "amount.balance" && values && values.balance !== undefined) {
      return `Bal ${values.balance}`;
    }
    return key;
  },
}));

describe("TransactionAmount", () => {
  it("prefixes money-in with '+' (ASCII plus)", () => {
    const { container } = render(
      <TransactionAmount
        direction="in"
        amount={1240}
        status="routine"
        density="comfortable"
      />,
    );
    expect(container.textContent?.startsWith("+1240")).toBe(true);
  });

  it("prefixes money-out with Unicode minus U+2212, not ASCII hyphen", () => {
    const { container } = render(
      <TransactionAmount
        direction="out"
        amount={85}
        status="routine"
        density="comfortable"
      />,
    );
    expect(container.textContent?.startsWith("−85")).toBe(true);
    expect(container.textContent?.startsWith("-85")).toBe(false);
  });

  it("exposes data-txn-direction='in' + data-txn-status='routine' for money-in routine", () => {
    const { container } = render(
      <TransactionAmount
        direction="in"
        amount={500}
        status="routine"
        density="comfortable"
      />,
    );
    const root = container.querySelector("[data-txn-amount]");
    expect(root?.getAttribute("data-txn-direction")).toBe("in");
    expect(root?.getAttribute("data-txn-status")).toBe("routine");
  });

  it("exposes data-txn-status='failed' when status is failed", () => {
    const { container } = render(
      <TransactionAmount
        direction="out"
        amount={50}
        status="failed"
        density="comfortable"
      />,
    );
    const root = container.querySelector("[data-txn-amount]");
    expect(root?.getAttribute("data-txn-status")).toBe("failed");
  });

});
