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
  useFormatter: () => ({
    number: (n: number) => String(n),
  }),
}));

describe("TransactionsPanelHeader", () => {
  it("does not own a live region — the panel-level aria-live is the only announcement source", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={10}
        summary={{ in: 150, out: 30, net: 120 }}
      />,
    );
    expect(container.querySelectorAll("[aria-live]").length).toBe(0);
    expect(container.querySelectorAll('[role="status"]').length).toBe(0);
    const summary = container.querySelector("[data-transactions-summary]");
    expect(summary).toBeTruthy();
    expect(summary?.getAttribute("aria-label")).toBeTruthy();
  });

  it("exposes the in/out/net/shown counts as stable data attributes", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={10}
        summary={{ in: 150, out: 30, net: 120 }}
      />,
    );
    const region = container.querySelector("[data-transactions-summary]")!;
    expect(region.getAttribute("data-transactions-shown")).toBe("10");
    expect(region.getAttribute("data-transactions-in")).toBe("150");
    expect(region.getAttribute("data-transactions-out")).toBe("30");
    expect(region.getAttribute("data-transactions-net")).toBe("120");
  });

  it("renders +in · −out · Net +N for a net-positive summary", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={3}
        summary={{ in: 150, out: 30, net: 120 }}
      />,
    );
    const region = container.querySelector("[data-transactions-summary]")!;
    expect(region.textContent).toContain("+150");
    expect(region.textContent).toContain("−30");
    expect(region.textContent).toContain("+120");
  });

  it("surfaces negative net via the data attribute and signed display text", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={2}
        summary={{ in: 0, out: 40, net: -40 }}
      />,
    );
    const region = container.querySelector("[data-transactions-summary]")!;
    expect(region.getAttribute("data-transactions-net")).toBe("-40");
    expect(region.textContent).toContain("−40");
    expect(region.textContent).not.toContain("+40");
  });

  it("renders a progress indicator with role=presentation and aria-hidden", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={5}
        summary={{ in: 0, out: 0, net: 0 }}
      />,
    );
    const bar = container.querySelector("[data-transactions-progress]");
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute("role")).toBe("presentation");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing in the export slot when exportSlot is omitted", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={5}
        summary={{ in: 0, out: 0, net: 0 }}
      />,
    );
    expect(container.querySelector("[data-export-slot]")).toBeNull();
    expect(container.querySelector("[data-transactions-export]")).toBeNull();
  });

  it("mounts an exportSlot child next to the summary when provided", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={5}
        summary={{ in: 0, out: 0, net: 0 }}
        exportSlot={<span data-export-slot="mounted">slot</span>}
      />,
    );
    const slot = container.querySelector("[data-export-slot='mounted']");
    expect(slot).toBeTruthy();
    expect(slot?.textContent).toBe("slot");
  });

  it("sets data-transactions-progress to 0 when shownCount is 0", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={0}
        summary={{ in: 0, out: 0, net: 0 }}
      />,
    );
    expect(
      container.querySelector("[data-transactions-progress]")?.getAttribute(
        "data-transactions-progress",
      ),
    ).toBe("0");
  });

  it("caps data-transactions-progress at 100 once shownCount >= 25", () => {
    const { container } = render(
      <TransactionsPanelHeader
        shownCount={50}
        summary={{ in: 0, out: 0, net: 0 }}
      />,
    );
    expect(
      container.querySelector("[data-transactions-progress]")?.getAttribute(
        "data-transactions-progress",
      ),
    ).toBe("100");
  });
});
