import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: (d: Date) => d.toISOString().slice(0, 10),
  }),
}));

import { DateRangePicker } from "@/components/billing/transactions/date-range-picker";

describe("DateRangePicker", () => {
  it("trigger label falls back to the localized default when from/to are null", () => {
    const { container } = render(
      <DateRangePicker from={null} to={null} onChange={() => undefined} />,
    );
    const trigger = container.querySelector("[data-transactions-date-range]")!;
    expect(trigger.getAttribute("data-date-active")).toBe("false");
    expect(trigger.textContent).toContain("label");
  });

  it("trigger label shows formatted from – to when both endpoints are set", () => {
    const from = new Date("2026-04-01T00:00:00Z");
    const to = new Date("2026-04-20T00:00:00Z");
    const { container } = render(
      <DateRangePicker from={from} to={to} onChange={() => undefined} />,
    );
    const trigger = container.querySelector("[data-transactions-date-range]")!;
    expect(trigger.getAttribute("data-date-active")).toBe("true");
    expect(trigger.textContent).toContain("2026-04-01");
    expect(trigger.textContent).toContain("2026-04-20");
  });

  it("renders six preset chips with data-date-preset attributes", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DateRangePicker from={null} to={null} onChange={() => undefined} />,
    );
    await user.click(
      container.querySelector(
        "[data-transactions-date-range]",
      )! as HTMLElement,
    );
    const presets = await screen.findAllByRole("button", { name: /presets\./ });
    const values = presets.map((el) => el.getAttribute("data-date-preset"));
    expect(values).toEqual(["today", "7d", "30d", "90d", "ytd", "all"]);
  });

  it("clicking a preset (today) calls onChange with from = startOfDay, to = now", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <DateRangePicker from={null} to={null} onChange={onChange} />,
    );
    await user.click(
      container.querySelector(
        "[data-transactions-date-range]",
      )! as HTMLElement,
    );
    const today = await screen.findByRole("button", { name: "presets.today" });
    await user.click(today);
    expect(onChange).toHaveBeenCalledTimes(1);
    const range = onChange.mock.calls[0][0] as { from: Date; to: Date };
    expect(range.from).toBeInstanceOf(Date);
    expect(range.to).toBeInstanceOf(Date);
    expect(range.from.getHours()).toBe(0);
    expect(range.from.getMinutes()).toBe(0);
    expect(range.to.getTime()).toBeGreaterThanOrEqual(range.from.getTime());
  });

  it("the 'all' preset calls onChange with both endpoints null", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <DateRangePicker
        from={new Date()}
        to={new Date()}
        onChange={onChange}
      />,
    );
    await user.click(
      container.querySelector(
        "[data-transactions-date-range]",
      )! as HTMLElement,
    );
    const all = await screen.findByRole("button", { name: "presets.all" });
    await user.click(all);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ from: null, to: null });
  });

  it("the 7d preset spans 7 calendar days back from now", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(
      <DateRangePicker from={null} to={null} onChange={onChange} />,
    );
    await user.click(
      container.querySelector(
        "[data-transactions-date-range]",
      )! as HTMLElement,
    );
    const sevenDays = await screen.findByRole("button", {
      name: "presets.7d",
    });
    await user.click(sevenDays);
    const range = onChange.mock.calls[0][0] as { from: Date; to: Date };
    const span = range.to.getTime() - range.from.getTime();
    const sevenDaysMs = 7 * 86_400_000;
    // Allow a couple of milliseconds slack for from = startOfDay rounding.
    expect(span).toBeGreaterThan(sevenDaysMs - 86_400_000);
    expect(span).toBeLessThan(sevenDaysMs + 86_400_000);
  });
});
