import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  FilterMultiSelect,
  type FilterOption,
} from "@/components/billing/transactions/filter-multi-select";

const TYPE_OPTIONS: FilterOption<"purchase" | "usage" | "grant">[] = [
  { value: "purchase", label: "Credit purchase", count: 14 },
  { value: "usage", label: "Usage", count: 123 },
  { value: "grant", label: "Free credit grant", count: 5 },
];

function Wrapper({
  initial = [],
  onChange,
}: {
  initial?: ReadonlyArray<"purchase" | "usage" | "grant">;
  onChange?: (next: readonly string[]) => void;
}) {
  const handle = vi.fn(onChange);
  return (
    <FilterMultiSelect
      label="Type"
      facet="type"
      options={TYPE_OPTIONS}
      value={initial}
      onChange={(next) => {
        handle(next);
      }}
    />
  );
}

describe("FilterMultiSelect", () => {
  it("trigger surfaces facet + selected count via data attributes", () => {
    const { container } = render(<Wrapper initial={["purchase", "usage"]} />);
    const trigger = container.querySelector("[data-filter-multi-select]")!;
    expect(trigger.getAttribute("data-filter-multi-select")).toBe("type");
    expect(trigger.getAttribute("data-filter-selected")).toBe("2");
  });

  it("does not render the count badge when nothing is selected", () => {
    const { container } = render(<Wrapper initial={[]} />);
    const trigger = container.querySelector("[data-filter-multi-select]")!;
    expect(trigger.getAttribute("data-filter-selected")).toBe("0");
    expect(trigger.querySelector("[data-slot='badge']")).toBeNull();
  });

  it("opens a listbox with aria-multiselectable=true on click", async () => {
    const user = userEvent.setup();
    const { container } = render(<Wrapper />);
    await user.click(
      container.querySelector("[data-filter-multi-select]")! as HTMLElement,
    );
    const listbox = await screen.findByRole("listbox");
    expect(listbox.getAttribute("aria-multiselectable")).toBe("true");
    expect(listbox.getAttribute("data-filter-listbox")).toBe("type");
  });

  it("each option exposes role=option, data-filter-option, and aria-selected", async () => {
    const user = userEvent.setup();
    const { container } = render(<Wrapper initial={["usage"]} />);
    await user.click(
      container.querySelector("[data-filter-multi-select]")! as HTMLElement,
    );
    const options = await screen.findAllByRole("option");
    expect(options.length).toBe(3);
    const usage = options.find(
      (el) => el.getAttribute("data-filter-option") === "usage",
    )!;
    expect(usage.getAttribute("aria-selected")).toBe("true");
    expect(usage.getAttribute("data-filter-option-selected")).toBe("true");
    const purchase = options.find(
      (el) => el.getAttribute("data-filter-option") === "purchase",
    )!;
    expect(purchase.getAttribute("aria-selected")).toBe("false");
  });

  it("clicking an unselected option calls onChange with it appended", async () => {
    const user = userEvent.setup();
    const handle = vi.fn();
    const { container } = render(
      <FilterMultiSelect
        label="Type"
        facet="type"
        options={TYPE_OPTIONS}
        value={["purchase"]}
        onChange={handle}
      />,
    );
    await user.click(
      container.querySelector("[data-filter-multi-select]")! as HTMLElement,
    );
    const usage = await screen.findByRole("option", { name: /Usage/ });
    await user.click(usage);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toEqual(["purchase", "usage"]);
  });

  it("clicking a selected option calls onChange with it removed", async () => {
    const user = userEvent.setup();
    const handle = vi.fn();
    const { container } = render(
      <FilterMultiSelect
        label="Type"
        facet="type"
        options={TYPE_OPTIONS}
        value={["purchase", "usage"]}
        onChange={handle}
      />,
    );
    await user.click(
      container.querySelector("[data-filter-multi-select]")! as HTMLElement,
    );
    const purchase = await screen.findByRole("option", {
      name: /Credit purchase/,
    });
    await user.click(purchase);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toEqual(["usage"]);
  });

  it("Space and Enter on a focused option toggle it", async () => {
    const user = userEvent.setup();
    const handle = vi.fn();
    const { container } = render(
      <FilterMultiSelect
        label="Type"
        facet="type"
        options={TYPE_OPTIONS}
        value={[]}
        onChange={handle}
      />,
    );
    await user.click(
      container.querySelector("[data-filter-multi-select]")! as HTMLElement,
    );
    const usage = await screen.findByRole("option", { name: /Usage/ });
    usage.focus();
    await user.keyboard(" ");
    expect(handle.mock.calls[0][0]).toEqual(["usage"]);
    handle.mockClear();
    await user.keyboard("{Enter}");
    expect(handle.mock.calls[0][0]).toEqual(["usage"]);
  });

  it("each option renders its count alongside the label", async () => {
    const user = userEvent.setup();
    const { container } = render(<Wrapper />);
    await user.click(
      container.querySelector("[data-filter-multi-select]")! as HTMLElement,
    );
    const usage = await screen.findByRole("option", { name: /Usage/ });
    expect(usage.textContent).toContain("Usage");
    expect(usage.textContent).toContain("123");
  });
});
