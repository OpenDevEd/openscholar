/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <SourcesPanelToolbar>.
 *
 * Asserts on the user-observable contract of the redesigned toolbar:
 * - search input (role=searchbox) fires onQueryChange on typing
 * - a clear-search button appears only when there's a query and resets it
 * - bulk include/exclude/invert buttons fire Convex mutations with the
 *   visible sourceIds and the expected `included` value
 * - bulk buttons are disabled when visibleRows is empty
 * - the source filter Select reflects `chipSelected` on the trigger
 * - the sort trigger surfaces the current sort field and direction via
 *   data-sort-field and data-sort-dir for test/route reasoning
 *
 * No CSS-class assertions per project doctrine — attributes and roles
 * only.
 */
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SourcesPanelToolbar } from "@/components/extraction/chat/sources-panel/sources-panel-toolbar";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import type { SortDir, SortField } from "@/lib/chat/sort/source-comparators";
import type { ChipCounts, SourceChip } from "@/lib/chat/source-chips";

const bulkSpy = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => {
    const fn = bulkSpy;
    Object.assign(fn, { withOptimisticUpdate: () => fn });
    return fn;
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      chatPapers: {
        bulkSetChatPapers: "stub:bulkSetChatPapers",
        listChatSourcesWithInclusion: "stub:listChatSourcesWithInclusion",
      },
    },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

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
    title: `Paper ${n}`,
    authors: [`Author ${n}`],
    year: 2024,
    abstract: null,
    doi: null,
    pdfUrl: null,
    openalexId: `W${n}`,
    bucketKey: `openalex:W${n}`,
    sourceType: "openalex",
  };
}

const baseCounts: ChipCounts = {
  all: 3,
  openalex: 3,
  zotero: 0,
  unknown: 0,
};

function Harness({
  visibleRows = [row(1), row(2)],
  query = "",
  sort = "added" as SortField,
  dir = "asc" as SortDir,
  chipSelected = "all" as SourceChip,
  chipCounts = baseCounts,
  onQueryChange = vi.fn(),
  onSortChange = vi.fn(),
  onChipChange = vi.fn(),
  isSearchStale,
}: {
  visibleRows?: ChatSourceRow[];
  query?: string;
  sort?: SortField;
  dir?: SortDir;
  chipSelected?: SourceChip;
  chipCounts?: ChipCounts;
  onQueryChange?: (v: string) => void;
  onSortChange?: (f: SortField, d: SortDir) => void;
  onChipChange?: (c: SourceChip) => void;
  isSearchStale?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <SourcesPanelToolbar
      jobId={job}
      visibleRows={visibleRows}
      query={query}
      onQueryChange={onQueryChange}
      sort={sort}
      dir={dir}
      onSortChange={onSortChange}
      chipSelected={chipSelected}
      chipCounts={chipCounts}
      onChipChange={onChipChange}
      searchInputRef={ref}
      isSearchStale={isSearchStale}
    />
  );
}

describe("<SourcesPanelToolbar>", () => {
  it("typing in the search input fires onQueryChange with the new value", () => {
    const onQueryChange = vi.fn();
    render(<Harness onQueryChange={onQueryChange} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "photosynthesis" } });
    expect(onQueryChange).toHaveBeenCalledWith("photosynthesis");
  });

  it("shows a clear-search button only when the query is non-empty", () => {
    const { rerender } = render(<Harness query="" />);
    expect(
      document.querySelector("[data-sources-panel-search-clear]"),
    ).toBeNull();
    rerender(<Harness query="foo" />);
    expect(
      document.querySelector("[data-sources-panel-search-clear]"),
    ).not.toBeNull();
  });

  it("clicking the clear-search button fires onQueryChange with an empty string", () => {
    const onQueryChange = vi.fn();
    render(<Harness query="foo" onQueryChange={onQueryChange} />);
    const clear = document.querySelector(
      "[data-sources-panel-search-clear]",
    ) as HTMLElement;
    fireEvent.click(clear);
    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  it("clicking the bulk Include button calls bulkSetChatPapers with every visible sourceId + included=true", () => {
    bulkSpy.mockClear();
    bulkSpy.mockResolvedValue(undefined);
    render(<Harness visibleRows={[row(1), row(2), row(3)]} />);
    const includeBtn = document.querySelector("[data-bulk-action='include']");
    fireEvent.click(includeBtn as Element);
    expect(bulkSpy).toHaveBeenCalledWith({
      jobId: job,
      sourceIds: [src(1), src(2), src(3)],
      included: true,
    });
  });

  it("clicking the bulk Exclude button calls bulkSetChatPapers with included=false", () => {
    bulkSpy.mockClear();
    bulkSpy.mockResolvedValue(undefined);
    render(<Harness visibleRows={[row(1), row(2)]} />);
    const excludeBtn = document.querySelector("[data-bulk-action='exclude']");
    fireEvent.click(excludeBtn as Element);
    expect(bulkSpy).toHaveBeenCalledWith({
      jobId: job,
      sourceIds: [src(1), src(2)],
      included: false,
    });
  });

  it("bulk buttons are disabled when visibleRows is empty", () => {
    render(<Harness visibleRows={[]} />);
    const includeBtn = document.querySelector("[data-bulk-action='include']");
    const excludeBtn = document.querySelector("[data-bulk-action='exclude']");
    const invertBtn = document.querySelector("[data-bulk-action='invert']");
    expect(includeBtn?.hasAttribute("disabled")).toBe(true);
    expect(excludeBtn?.hasAttribute("disabled")).toBe(true);
    expect(invertBtn?.hasAttribute("disabled")).toBe(true);
  });

  it("the source filter Select trigger exposes data-source-selected reflecting the chip prop", () => {
    render(<Harness chipSelected="openalex" />);
    const trigger = document.querySelector("[data-sources-filter-trigger]");
    expect(trigger?.getAttribute("data-source-selected")).toBe("openalex");
  });

  it("the sort trigger exposes data-sort-field and data-sort-dir reflecting props", () => {
    render(<Harness sort="year" dir="desc" />);
    const sortTrigger = document.querySelector("[data-sort-trigger]");
    expect(sortTrigger?.getAttribute("data-sort-field")).toBe("year");
    expect(sortTrigger?.getAttribute("data-sort-dir")).toBe("desc");
  });

  it("defaults data-search-deferred to 'false' on the search input when isSearchStale is not passed", () => {
    render(<Harness />);
    const input = screen.getByRole("searchbox");
    expect(input.getAttribute("data-search-deferred")).toBe("false");
  });

  it("forwards isSearchStale=true to data-search-deferred='true' on the search input", () => {
    render(<Harness isSearchStale={true} />);
    const input = screen.getByRole("searchbox");
    expect(input.getAttribute("data-search-deferred")).toBe("true");
  });

  it("transitions data-search-deferred from 'true' back to 'false' when isSearchStale clears", () => {
    const { rerender } = render(<Harness isSearchStale={true} />);
    expect(
      screen.getByRole("searchbox").getAttribute("data-search-deferred"),
    ).toBe("true");
    rerender(<Harness isSearchStale={false} />);
    expect(
      screen.getByRole("searchbox").getAttribute("data-search-deferred"),
    ).toBe("false");
  });
});
