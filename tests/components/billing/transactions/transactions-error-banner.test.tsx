/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { TransactionsErrorBanner } from "@/components/billing/transactions/transactions-error-banner";

describe("TransactionsErrorBanner", () => {
  it("renders an alert with the default localized message", () => {
    render(<TransactionsErrorBanner onRetry={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("data-transactions-error");
    expect(alert).toHaveTextContent(/title/);
    expect(alert).toHaveTextContent(/message/);
  });

  it("renders the custom message when provided (overrides the default)", () => {
    render(
      <TransactionsErrorBanner
        onRetry={vi.fn()}
        message="server returned 500"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("server returned 500");
  });

  it("invokes onRetry when the retry button is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<TransactionsErrorBanner onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("exposes a retriable button via [data-transactions-error-retry]", () => {
    const { container } = render(
      <TransactionsErrorBanner onRetry={vi.fn()} />,
    );
    expect(
      container.querySelector("[data-transactions-error-retry]"),
    ).toBeInTheDocument();
  });
});
