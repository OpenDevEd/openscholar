/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for useSourcesPanelKeyboard.
 *
 * Asserts on the WAI-ARIA APG listbox-with-aria-activedescendant
 * contract:
 * - / focuses the search input (when focus is not already in it)
 * - Esc clears the search when the search has a query AND owns focus;
 *   otherwise releases the active descendant
 * - ↓ moves the active descendant; aria-activedescendant updates
 * - Space toggles the active descendant via onToggleOne
 * - ⌘A invokes onIncludeAllVisible
 * - Shift+⌘A invokes onInvertVisible
 *
 * No CSS-class assertions per project doctrine.
 */
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useSourcesPanelKeyboard } from "@/components/extraction/chat/sources-panel/use-sources-panel-keyboard";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";

const cp = (n: number) => `cp${n}` as unknown as Id<"chatPapers">;
const src = (n: number) => `src${n}` as unknown as Id<"extractionJobSources">;
const job = "job1" as unknown as Id<"extractionJobs">;

function row(n: number, included = true): ChatSourceRow {
  return {
    chatPaperId: cp(n),
    sourceId: src(n),
    jobId: job,
    position: n,
    included,
    title: `P${n}`,
    authors: [],
    year: 2024,
    abstract: null,
    doi: null,
    pdfUrl: null,
    openalexId: null,
    bucketKey: `k${n}`,
    sourceType: "openalex",
  };
}

interface HarnessProps {
  rows: ChatSourceRow[];
  hasSearchQuery?: boolean;
  onToggleOne?: (row: ChatSourceRow, next: boolean) => void;
  onToggleRange?: (rows: ChatSourceRow[], next: boolean) => void;
  onIncludeAllVisible?: () => void;
  onInvertVisible?: () => void;
  onClearSearch?: () => void;
}

function Harness(props: HarnessProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const kb = useSourcesPanelKeyboard({
    visibleRows: props.rows,
    onToggleOne: props.onToggleOne ?? vi.fn(),
    onToggleRange: props.onToggleRange ?? vi.fn(),
    onIncludeAllVisible: props.onIncludeAllVisible ?? vi.fn(),
    onInvertVisible: props.onInvertVisible ?? vi.fn(),
    onClearSearch: props.onClearSearch ?? vi.fn(),
    hasSearchQuery: props.hasSearchQuery ?? false,
    searchInputRef: searchRef,
  });
  // Mirror the real <SourcesPanel>: keydown handler attached to the
  // outer panel wrapper so events from BOTH the search input and the
  // listbox bubble through it.
  return (
    <div data-testid="panel" onKeyDown={kb.onKeyDown}>
      <input
        ref={searchRef}
        data-testid="search-input"
        type="search"
        defaultValue=""
      />
      <div
        data-testid="listbox"
        role="listbox"
        aria-activedescendant={kb.activeId ?? undefined}
        tabIndex={0}
      >
        active={kb.activeId ?? "null"}
      </div>
    </div>
  );
}

describe("useSourcesPanelKeyboard", () => {
  it("/ key focuses the search input", () => {
    render(<Harness rows={[row(1), row(2)]} />);
    const listbox = screen.getByTestId("listbox");
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "/" });
    expect(document.activeElement).toBe(screen.getByTestId("search-input"));
  });

  it("ArrowDown moves the active descendant", () => {
    const { rerender } = render(<Harness rows={[row(1), row(2), row(3)]} />);
    const listbox = screen.getByTestId("listbox");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      `src-row-${cp(1)}`,
    );
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    rerender(<Harness rows={[row(1), row(2), row(3)]} />);
    expect(
      screen.getByTestId("listbox").getAttribute("aria-activedescendant"),
    ).toBe(`src-row-${cp(2)}`);
  });

  it("Space toggles the active descendant via onToggleOne", () => {
    const onToggleOne = vi.fn();
    render(
      <Harness
        rows={[row(1, true), row(2, false)]}
        onToggleOne={onToggleOne}
      />,
    );
    const listbox = screen.getByTestId("listbox");
    fireEvent.keyDown(listbox, { key: " " });
    expect(onToggleOne).toHaveBeenCalledTimes(1);
    const [calledRow, calledNext] = onToggleOne.mock.calls[0];
    expect(calledRow.chatPaperId).toBe(cp(1));
    expect(calledNext).toBe(false); // included was true → next is false
  });

  it("Cmd+A (or Ctrl+A) invokes onIncludeAllVisible", () => {
    const onIncludeAllVisible = vi.fn();
    render(
      <Harness rows={[row(1), row(2)]} onIncludeAllVisible={onIncludeAllVisible} />,
    );
    const listbox = screen.getByTestId("listbox");
    fireEvent.keyDown(listbox, { key: "a", metaKey: true });
    expect(onIncludeAllVisible).toHaveBeenCalledTimes(1);
  });

  it("Shift+Cmd+A invokes onInvertVisible (not onIncludeAllVisible)", () => {
    const onIncludeAllVisible = vi.fn();
    const onInvertVisible = vi.fn();
    render(
      <Harness
        rows={[row(1), row(2)]}
        onIncludeAllVisible={onIncludeAllVisible}
        onInvertVisible={onInvertVisible}
      />,
    );
    const listbox = screen.getByTestId("listbox");
    fireEvent.keyDown(listbox, { key: "a", metaKey: true, shiftKey: true });
    expect(onInvertVisible).toHaveBeenCalledTimes(1);
    expect(onIncludeAllVisible).not.toHaveBeenCalled();
  });

  it("Esc inside the search input clears the query when there is one", () => {
    const onClearSearch = vi.fn();
    render(
      <Harness
        rows={[row(1)]}
        hasSearchQuery={true}
        onClearSearch={onClearSearch}
      />,
    );
    const search = screen.getByTestId("search-input");
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });
});
