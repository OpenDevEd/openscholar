/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <SourcesPanelToolbar>.
 *
 * Asserts on the user-observable contract:
 * - typing in the search input fires onQueryChange with the new value
 *   (the panel state hook is the URL/filter source-of-truth)
 * - clicking a sort pill while it's already active flips dir, while
 *   clicking an inactive pill activates it with the field's default
 *   direction (year and inContext default to desc)
 * - clicking the bulk Include button calls bulkSetChatPapers with
 *   every visible row's sourceId and included=true
 * - bulk buttons are disabled when there are no visible rows
 *
 * No CSS-class assertions per project doctrine.
 */
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SourcesPanelToolbar } from "@/components/extraction/chat/sources-panel/sources-panel-toolbar";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import type { SortDir, SortField } from "@/lib/chat/sort/source-comparators";

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

function Harness({
  visibleRows = [row(1), row(2)],
  query = "",
  sort = "added" as SortField,
  dir = "asc" as SortDir,
  onQueryChange = vi.fn(),
  onSortChange = vi.fn(),
}: {
  visibleRows?: ChatSourceRow[];
  query?: string;
  sort?: SortField;
  dir?: SortDir;
  onQueryChange?: (v: string) => void;
  onSortChange?: (f: SortField, d: SortDir) => void;
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
      searchInputRef={ref}
    />
  );
}

describe("<SourcesPanelToolbar>", () => {
  it("typing in the search input fires onQueryChange", () => {
    const onQueryChange = vi.fn();
    render(<Harness onQueryChange={onQueryChange} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "photosynthesis" } });
    expect(onQueryChange).toHaveBeenCalledWith("photosynthesis");
  });

  it("clicking the active sort pill flips dir asc <-> desc", () => {
    const onSortChange = vi.fn();
    render(
      <Harness sort="title" dir="asc" onSortChange={onSortChange} />,
    );
    const titlePill = document.querySelector("[data-sort-pill='title']");
    expect(titlePill).not.toBeNull();
    fireEvent.click(titlePill as Element);
    expect(onSortChange).toHaveBeenCalledWith("title", "desc");
  });

  it("clicking an inactive sort pill activates it with the field default direction (year defaults to desc)", () => {
    const onSortChange = vi.fn();
    render(
      <Harness sort="added" dir="asc" onSortChange={onSortChange} />,
    );
    const yearPill = document.querySelector("[data-sort-pill='year']");
    fireEvent.click(yearPill as Element);
    expect(onSortChange).toHaveBeenCalledWith("year", "desc");
  });

  it("clicking the bulk Include button calls bulkSetChatPapers with every visible sourceId + included=true", async () => {
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

  it("bulk buttons are disabled when visibleRows is empty", () => {
    render(<Harness visibleRows={[]} />);
    const includeBtn = document.querySelector("[data-bulk-action='include']");
    expect(includeBtn?.hasAttribute("disabled")).toBe(true);
  });
});
