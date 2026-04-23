import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { TransactionsPanelHeader } from "@/components/billing/transactions/transactions-panel-header";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params
      ? `${key}:${Object.entries(params)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",")}`
      : key,
}));

describe("TransactionsPanelHeader", () => {
  it("does not own a live region — the panel-level aria-live is the only announcement source", () => {
    const { container } = render(<TransactionsPanelHeader shownCount={10} />);
    expect(container.querySelectorAll("[aria-live]").length).toBe(0);
    expect(container.querySelectorAll('[role="status"]').length).toBe(0);
    expect(container.querySelector("[data-transactions-summary]")).toBeNull();
  });

  it("renders a progress indicator with role=presentation and aria-hidden", () => {
    const { container } = render(<TransactionsPanelHeader shownCount={5} />);
    const bar = container.querySelector("[data-transactions-progress]");
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute("role")).toBe("presentation");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing in the export slot when exportSlot is omitted", () => {
    const { container } = render(<TransactionsPanelHeader shownCount={5} />);
    expect(container.querySelector("[data-export-slot]")).toBeNull();
    expect(container.querySelector("[data-transactions-export]")).toBeNull();
  });

  it("mounts an exportSlot child in the header when provided", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={5}
        exportSlot={<span data-export-slot="mounted">slot</span>}
      />,
    );
    const slot = container.querySelector("[data-export-slot='mounted']");
    expect(slot).toBeTruthy();
    expect(slot?.textContent).toBe("slot");
  });

  it("sets data-transactions-progress to 0 when shownCount is 0", () => {
    const { container } = render(<TransactionsPanelHeader shownCount={0} />);
    expect(
      container.querySelector("[data-transactions-progress]")?.getAttribute(
        "data-transactions-progress",
      ),
    ).toBe("0");
  });

  it("caps data-transactions-progress at 100 once shownCount >= 25", () => {
    const { container } = render(<TransactionsPanelHeader shownCount={50} />);
    expect(
      container.querySelector("[data-transactions-progress]")?.getAttribute(
        "data-transactions-progress",
      ),
    ).toBe("100");
  });
});
