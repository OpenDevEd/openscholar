/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

import { TransactionsEmptyState } from "@/components/billing/transactions/transactions-empty-state";

describe("TransactionsEmptyState", () => {
  describe("kind=no-data", () => {
    it("uses the no-data variant on data-transactions-empty", () => {
      const { container } = render(
        <TransactionsEmptyState kind="no-data" />,
      );
      const root = container.querySelector("[data-transactions-empty]")!;
      expect(root.getAttribute("data-transactions-empty")).toBe("no-data");
    });

    it("renders a status region containing the localized title + description", () => {
      render(<TransactionsEmptyState kind="no-data" />);
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(/no-data\.title/);
      expect(status).toHaveTextContent(/no-data\.description/);
    });

    it("renders a 'Buy credits' link to the billing top-up anchor", () => {
      render(<TransactionsEmptyState kind="no-data" />);
      const link = screen.getByRole("link", { name: /no-data\.cta/ });
      expect(link).toHaveAttribute("href", "/settings/billing#topup");
    });

    it("does not render a clear-filters button (no callback applies)", () => {
      const { container } = render(
        <TransactionsEmptyState kind="no-data" onClearFilters={vi.fn()} />,
      );
      expect(
        container.querySelector("[data-transactions-empty-clear]"),
      ).toBeNull();
    });
  });

  describe("kind=no-matches", () => {
    it("uses the no-matches variant on data-transactions-empty", () => {
      const { container } = render(
        <TransactionsEmptyState
          kind="no-matches"
          onClearFilters={vi.fn()}
        />,
      );
      const root = container.querySelector("[data-transactions-empty]")!;
      expect(root.getAttribute("data-transactions-empty")).toBe("no-matches");
    });

    it("renders a Clear filters button that invokes onClearFilters", async () => {
      const user = userEvent.setup();
      const onClear = vi.fn();
      render(
        <TransactionsEmptyState
          kind="no-matches"
          onClearFilters={onClear}
        />,
      );
      const button = screen.getByRole("button", { name: /no-matches\.cta/ });
      expect(button).toHaveAttribute("data-transactions-empty-clear");
      await user.click(button);
      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it("hides the clear button when no callback is supplied", () => {
      const { container } = render(
        <TransactionsEmptyState kind="no-matches" />,
      );
      expect(
        container.querySelector("[data-transactions-empty-clear]"),
      ).toBeNull();
    });
  });
});
