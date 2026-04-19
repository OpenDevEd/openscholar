/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <SourcesPanelList>.
 *
 * The list is the listbox surface — role=listbox, aria-multiselectable,
 * aria-activedescendant — and adapts the SelectableList primitive
 * (rule 8: reuse, do not rewrite). These tests assert on the contract
 * the higher-level panel + keyboard hook depend on:
 * - role=listbox + aria-multiselectable=true
 * - aria-activedescendant reflects the prop and points at a real DOM id
 * - clicking a row's checkbox calls toggleChatPaper with the paired
 *   chatPaperId and the inverted included flag
 * - showing the empty-state slot when the rows list is empty
 *
 * No CSS assertions per project doctrine.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SourcesPanelList } from "@/components/extraction/chat/sources-panel/sources-panel-list";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";

const toggleSpy = vi.fn();
const bulkSpy = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (mutationRef: unknown) => {
    const fn =
      mutationRef === "stub:toggleChatPaper"
        ? toggleSpy
        : mutationRef === "stub:bulkSetChatPapers"
          ? bulkSpy
          : vi.fn();
    Object.assign(fn, { withOptimisticUpdate: () => fn });
    return fn;
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      chatPapers: {
        toggleChatPaper: "stub:toggleChatPaper",
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
  toast: Object.assign(() => {}, { error: vi.fn() }),
}));

const cp = (n: number) => `cp${n}` as unknown as Id<"chatPapers">;
const src = (n: number) => `src${n}` as unknown as Id<"extractionJobSources">;
const job = "job1" as unknown as Id<"extractionJobs">;

function row(n: number, included: boolean): ChatSourceRow {
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
    ...{},
  };
}

describe("<SourcesPanelList>", () => {
  it("exposes role=listbox + aria-multiselectable + aria-activedescendant for the wrapper", () => {
    const rows = [row(1, true), row(2, false)];
    render(
      <SourcesPanelList
        jobId={job}
        rows={rows}
        matches={new Map()}
        query=""
        activeDescendantId={`src-row-${cp(2)}`}
        emptyState={<p>empty</p>}
      />,
    );
    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("aria-multiselectable")).toBe("true");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      `src-row-${cp(2)}`,
    );
  });

  it("clicking a row's checkbox calls toggleChatPaper with the inverted included flag", async () => {
    toggleSpy.mockClear();
    toggleSpy.mockResolvedValue(undefined);
    const rows = [row(1, true), row(2, false)];
    render(
      <SourcesPanelList
        jobId={job}
        rows={rows}
        matches={new Map()}
        query=""
        activeDescendantId={null}
        emptyState={<p>empty</p>}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    // SelectableList omits the header checkbox when onToggleAll is unset,
    // so the row checkboxes start at index 0.
    fireEvent.click(checkboxes[0]);
    expect(toggleSpy).toHaveBeenCalledWith({
      chatPaperId: cp(1),
      included: false,
    });
  });

  it("renders the emptyState slot when rows is empty", () => {
    render(
      <SourcesPanelList
        jobId={job}
        rows={[]}
        matches={new Map()}
        query=""
        activeDescendantId={null}
        emptyState={<p data-empty>nothing matches</p>}
      />,
    );
    expect(document.querySelector("[data-empty]")).not.toBeNull();
  });
});
