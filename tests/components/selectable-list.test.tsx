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
      onToggle={(r, next) => {
        update((prev) => {
          const n = new Set(prev);
          if (next) n.add(r.id);
          else n.delete(r.id);
          return n;
        });
      }}
      onToggleAll={(next) => {
        update(() =>
          next ? new Set(rows.map((r) => r.id)) : new Set(),
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

  it("clicking an unselected row passes next=true to onToggle", () => {
    const onToggle = vi.fn();
    render(
      <SelectableList<Row>
        items={rows}
        keyOf={(r) => r.id}
        isSelected={() => false}
        onToggle={onToggle}
        onToggleAll={() => {}}
        renderRow={(r) => <span>{r.title}</span>}
      />,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(onToggle).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "b" }),
      true,
    );
  });

  it("clicking a selected row passes next=false to onToggle (unselects)", () => {
    const onToggle = vi.fn();
    render(
      <SelectableList<Row>
        items={rows}
        keyOf={(r) => r.id}
        isSelected={(r) => r.id === "b"}
        onToggle={onToggle}
        onToggleAll={() => {}}
        renderRow={(r) => <span>{r.title}</span>}
      />,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(onToggle).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "b" }),
      false,
    );
  });

  it("header click passes next=true when nothing selected, next=false when all selected", () => {
    const onToggleAll = vi.fn();
    const { rerender } = render(
      <SelectableList<Row>
        items={rows}
        keyOf={(r) => r.id}
        isSelected={() => false}
        onToggle={() => {}}
        onToggleAll={onToggleAll}
        renderRow={(r) => <span>{r.title}</span>}
      />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggleAll).toHaveBeenLastCalledWith(true);

    rerender(
      <SelectableList<Row>
        items={rows}
        keyOf={(r) => r.id}
        isSelected={() => true}
        onToggle={() => {}}
        onToggleAll={onToggleAll}
        renderRow={(r) => <span>{r.title}</span>}
      />,
    );
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggleAll).toHaveBeenLastCalledWith(false);
  });

  it("shift-click across already-selected rows deselects them (next=false)", () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial={new Set(["a", "b", "c", "d"])}
        onChange={onChange}
      />,
    );
    // Click Alpha → flips to unselected. State: {b, c, d}.
    fireEvent.click(screen.getByText("Alpha"));
    // Shift-click Gamma → target = !isSelected(Gamma) = false.
    // Loop i=0..2: a (false=target, skip), b (true≠false, deselect), c (true≠false, deselect).
    // State: {d}.
    fireEvent.click(screen.getByText("Gamma"), { shiftKey: true });
    const snapshot = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect([...snapshot].sort()).toEqual(["d"]);
  });
});
