import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useState } from "react";
import { SelectableList } from "@/components/extraction/bucket/selectable-list";

type Row = { id: string; title: string };
const rows: Row[] = [
  { id: "a", title: "Alpha" },
  { id: "b", title: "Beta" },
  { id: "c", title: "Gamma" },
  { id: "d", title: "Delta" },
];

function Harness({
  initial = new Set<string>(),
  onChange,
}: {
  initial?: Set<string>;
  onChange?: (next: Set<string>) => void;
} = {}) {
  const [selected, setSelected] = useState<Set<string>>(initial);
  const update = (compute: (prev: Set<string>) => Set<string>) =>
    setSelected((prev) => {
      const next = compute(prev);
      onChange?.(next);
      return next;
    });
  return (
    <SelectableList<Row>
      items={rows}
      keyOf={(r) => r.id}
      isSelected={(r) => selected.has(r.id)}
      onToggle={(r) => {
        update((prev) => {
          const next = new Set(prev);
          if (next.has(r.id)) next.delete(r.id);
          else next.add(r.id);
          return next;
        });
      }}
      onToggleAll={() => {
        update((prev) =>
          prev.size === rows.length
            ? new Set()
            : new Set(rows.map((r) => r.id)),
        );
      }}
      renderRow={(r) => <span>{r.title}</span>}
    />
  );
}

describe("<SelectableList>", () => {
  it("renders a checkbox per row plus a header checkbox", () => {
    render(<Harness />);
    const checkboxes = screen.getAllByRole("checkbox");
    // 1 header + 4 rows
    expect(checkboxes).toHaveLength(1 + rows.length);
  });

  it("header goes indeterminate when some rows selected and checked when all", () => {
    render(<Harness initial={new Set(["a"])} />);
    const header = screen.getAllByRole("checkbox")[0];
    expect(header.getAttribute("data-state")).toBe("indeterminate");
  });

  it("clicking the header calls onToggleAll and selects everything", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.size).toBe(rows.length);
  });

  it("clicking a row toggles a single selection", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByText("Beta"));
    const snapshot = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect([...snapshot]).toEqual(["b"]);
  });

  it("shift-click extends the selection across the inclusive range", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    // First click row 0 (Alpha)
    fireEvent.click(screen.getByText("Alpha"));
    // Shift-click row 2 (Gamma) — should cover Alpha, Beta, Gamma
    fireEvent.click(screen.getByText("Gamma"), { shiftKey: true });
    const snapshot = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect([...snapshot].sort()).toEqual(["a", "b", "c"]);
  });

  it("space toggles the focused row", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const row = screen.getByText("Delta").closest("[data-selectable-row]")!;
    (row as HTMLElement).focus();
    fireEvent.keyDown(row, { key: " ", code: "Space" });
    const snapshot = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect([...snapshot]).toEqual(["d"]);
  });
});
