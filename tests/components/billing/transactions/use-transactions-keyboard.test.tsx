/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";

import { useTransactionsKeyboard } from "@/components/billing/transactions/use-transactions-keyboard";

interface RowMock {
  id: string;
}

interface HarnessProps {
  rows: readonly RowMock[];
  onActivateRow?: (id: string) => void;
  onClearSearch?: () => void;
  onOpenExport?: () => void;
  onCloseDrawer?: () => void;
  isDrawerOpen?: boolean;
}

function Harness({
  rows,
  onActivateRow = () => {},
  onClearSearch = () => {},
  onOpenExport = () => {},
  onCloseDrawer = () => {},
  isDrawerOpen = false,
}: HarnessProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { activeId } = useTransactionsKeyboard({
    rows,
    listRef,
    searchRef,
    onActivateRow,
    onClearSearch,
    onOpenExport,
    isDrawerOpen,
    onCloseDrawer,
  });
  return (
    <>
      <input ref={searchRef} aria-label="search" data-testid="search" />
      <div
        ref={listRef}
        role="list"
        tabIndex={0}
        data-testid="list"
        data-active-id={activeId ?? ""}
      >
        {rows.map((r) => (
          <div
            key={r.id}
            id={`txn-row-${r.id}`}
            role="listitem"
            data-row-id={r.id}
            data-active={r.id === activeId || undefined}
          />
        ))}
      </div>
    </>
  );
}

/**
 * Dispatch a keydown that bubbles to the window listener. The hook
 * checks `e.target` against `listRef.current.contains(e.target)`, so the
 * default target (defined by the element we dispatch on) matters: we
 * dispatch on the focused element when the test wants list-scoped
 * behavior, and on the body for global shortcuts.
 */
function dispatch(key: string, init: Partial<KeyboardEventInit> = {}) {
  act(() => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });
}

const ROWS: RowMock[] = [
  { id: "a" },
  { id: "b" },
  { id: "c" },
  { id: "d" },
];

describe("useTransactionsKeyboard", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "platform", {
      value: "Linux x86_64",
      configurable: true,
    });
  });

  it("'/' focuses the search input when fired outside any input", () => {
    render(<Harness rows={ROWS} />);
    expect(document.activeElement).toBe(document.body);
    dispatch("/");
    expect(document.activeElement).toBe(screen.getByTestId("search"));
  });

  it("ArrowDown from no active → first row becomes active", () => {
    render(<Harness rows={ROWS} />);
    screen.getByTestId("list").focus();
    dispatch("ArrowDown");
    expect(screen.getByTestId("list").getAttribute("data-active-id")).toBe("a");
  });

  it("ArrowDown past the end clamps to the last row", () => {
    render(<Harness rows={ROWS} />);
    const list = screen.getByTestId("list");
    list.focus();
    dispatch("ArrowDown");
    dispatch("ArrowDown");
    dispatch("ArrowDown");
    dispatch("ArrowDown");
    dispatch("ArrowDown"); // beyond the end
    expect(list.getAttribute("data-active-id")).toBe("d");
  });

  it("ArrowUp from the first row stays at the first row", () => {
    render(<Harness rows={ROWS} />);
    const list = screen.getByTestId("list");
    list.focus();
    dispatch("ArrowDown");
    dispatch("ArrowUp");
    expect(list.getAttribute("data-active-id")).toBe("a");
  });

  it("Enter on the active row calls onActivateRow with the active id", () => {
    const onActivate = vi.fn();
    render(<Harness rows={ROWS} onActivateRow={onActivate} />);
    const list = screen.getByTestId("list");
    list.focus();
    dispatch("ArrowDown");
    dispatch("ArrowDown");
    dispatch("Enter");
    expect(onActivate).toHaveBeenCalledWith("b");
  });

  it("Escape closes the drawer when one is open", () => {
    const onClose = vi.fn();
    render(<Harness rows={ROWS} isDrawerOpen onCloseDrawer={onClose} />);
    dispatch("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does NOT call onCloseDrawer when no drawer is open", () => {
    const onClose = vi.fn();
    render(<Harness rows={ROWS} isDrawerOpen={false} onCloseDrawer={onClose} />);
    dispatch("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape on the search input with a value calls onClearSearch", async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(<Harness rows={ROWS} onClearSearch={onClear} />);
    const search = screen.getByTestId("search");
    await user.type(search, "abc");
    expect(search).toHaveValue("abc");
    await user.keyboard("{Escape}");
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("'/' typed inside an input is NOT intercepted (input keeps focus)", async () => {
    const user = userEvent.setup();
    render(<Harness rows={ROWS} />);
    const search = screen.getByTestId("search");
    search.focus();
    await user.keyboard("/");
    expect(document.activeElement).toBe(search);
    expect(search).toHaveValue("/");
  });

  it("Cmd+E on Mac opens the export menu", () => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    const onOpen = vi.fn();
    render(<Harness rows={ROWS} onOpenExport={onOpen} />);
    dispatch("e", { metaKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+E on non-Mac opens the export menu", () => {
    Object.defineProperty(navigator, "platform", {
      value: "Linux x86_64",
      configurable: true,
    });
    const onOpen = vi.fn();
    render(<Harness rows={ROWS} onOpenExport={onOpen} />);
    dispatch("e", { ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("Cmd+E on non-Mac does NOT open the export menu (ctrlKey would)", () => {
    Object.defineProperty(navigator, "platform", {
      value: "Linux x86_64",
      configurable: true,
    });
    const onOpen = vi.fn();
    render(<Harness rows={ROWS} onOpenExport={onOpen} />);
    dispatch("e", { metaKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("activeId resets when the row set no longer contains it", () => {
    const { rerender } = render(<Harness rows={ROWS} />);
    screen.getByTestId("list").focus();
    dispatch("ArrowDown");
    dispatch("ArrowDown");
    dispatch("ArrowDown"); // active = c
    expect(screen.getByTestId("list").getAttribute("data-active-id")).toBe("c");

    // Filter drops 'c' from the row set
    rerender(<Harness rows={[{ id: "a" }, { id: "b" }, { id: "d" }]} />);
    expect(screen.getByTestId("list").getAttribute("data-active-id")).toBe("");
  });
});
