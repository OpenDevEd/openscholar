import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { TransactionIcon } from "@/components/billing/transactions/transaction-icon";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("TransactionIcon", () => {
  it("exposes data-txn-type for purchase rows", () => {
    const { container } = render(
      <TransactionIcon type="purchase" billingType={null} />,
    );
    const icon = container.querySelector("[data-txn-icon]");
    expect(icon?.getAttribute("data-txn-type")).toBe("purchase");
  });

  it("carries data-txn-billing-type='embedding' when usage row is indexing work", () => {
    const { container } = render(
      <TransactionIcon type="usage" billingType="embedding" />,
    );
    const icon = container.querySelector("[data-txn-icon]");
    expect(icon?.getAttribute("data-txn-billing-type")).toBe("embedding");
  });

  it("carries data-txn-billing-type='none' for purchase rows without a billing context", () => {
    const { container } = render(
      <TransactionIcon type="purchase" billingType={null} />,
    );
    const icon = container.querySelector("[data-txn-icon]");
    expect(icon?.getAttribute("data-txn-billing-type")).toBe("none");
  });

  it("renders exactly one sub-icon wrapper when billingType is set", () => {
    const { container } = render(
      <TransactionIcon type="usage" billingType="extraction_llm" />,
    );
    const subWrapper = container.querySelectorAll(
      "[data-txn-icon] > span[aria-hidden='true']",
    );
    expect(subWrapper.length).toBe(1);
  });

  it("omits the sub-icon wrapper when billingType is null", () => {
    const { container } = render(
      <TransactionIcon type="purchase" billingType={null} />,
    );
    const subWrapper = container.querySelectorAll(
      "[data-txn-icon] > span[aria-hidden='true']",
    );
    expect(subWrapper.length).toBe(0);
  });

  it("hides the primary glyph from assistive tech via aria-hidden", () => {
    const { container } = render(
      <TransactionIcon type="grant" billingType={null} />,
    );
    const primaryGlyph = container.querySelector(
      "[data-txn-icon] > svg",
    );
    expect(primaryGlyph?.getAttribute("aria-hidden")).toBe("true");
  });
});
