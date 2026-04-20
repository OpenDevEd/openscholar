import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TransactionsGroupHeader } from "@/components/billing/transactions/transactions-group-header";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `group.${key}`,
  useFormatter: () => ({
    dateTime: (d: Date, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", opts).format(d),
  }),
}));

describe("TransactionsGroupHeader", () => {
  it("is role=presentation so axe does not count it as a heading", () => {
    const { container } = render(<TransactionsGroupHeader groupKey="today" />);
    const el = container.querySelector("[data-transactions-group-header]")!;
    expect(el.getAttribute("role")).toBe("presentation");
  });

  it("exposes the raw group key as a behavioral data attribute", () => {
    const { container } = render(<TransactionsGroupHeader groupKey="today" />);
    expect(
      container
        .querySelector("[data-transactions-group-header]")!
        .getAttribute("data-transactions-group-header"),
    ).toBe("today");
  });

  it("renders the i18n key for today/yesterday/this-week/last-week", () => {
    const { rerender, container } = render(
      <TransactionsGroupHeader groupKey="today" />,
    );
    expect(container.textContent).toBe("group.today");
    rerender(<TransactionsGroupHeader groupKey="yesterday" />);
    expect(container.textContent).toBe("group.yesterday");
    rerender(<TransactionsGroupHeader groupKey="this-week" />);
    expect(container.textContent).toBe("group.thisWeek");
    rerender(<TransactionsGroupHeader groupKey="last-week" />);
    expect(container.textContent).toBe("group.lastWeek");
  });

  it("renders a localized 'Month Year' label for a month-YYYY-MM key", () => {
    const { container } = render(
      <TransactionsGroupHeader groupKey="month-2026-03" />,
    );
    expect(container.textContent).toBe("March 2026");
    expect(
      container
        .querySelector("[data-transactions-group-header]")!
        .getAttribute("data-transactions-group-header"),
    ).toBe("month-2026-03");
  });

  it("renders the November month name for month-2025-11 (boundary)", () => {
    const { container } = render(
      <TransactionsGroupHeader groupKey="month-2025-11" />,
    );
    expect(container.textContent).toBe("November 2025");
  });

  it("exposes the group header via its data attribute regardless of label", () => {
    render(<TransactionsGroupHeader groupKey="month-2026-01" />);
    expect(screen.getByText("January 2026")).toBeInTheDocument();
  });
});
