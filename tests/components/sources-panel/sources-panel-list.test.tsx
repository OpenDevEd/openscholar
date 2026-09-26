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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";
import { SourcesPanelList } from "@/components/extraction/chat/sources-panel/sources-panel-list";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";

import { installJsdomVirtualizerStubs } from "@/tests/helpers/jsdom-virtualizer";

let restoreLayoutStubs: () => void;
beforeEach(() => {
  restoreLayoutStubs = installJsdomVirtualizerStubs();
});
afterEach(() => {
  restoreLayoutStubs();
});

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
    citedByCount: null,
    venueName: null,
    workType: null,
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

  it("clicking a row toggles via toggleChatPaper with the inverted included flag", async () => {
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
    // Listbox-pattern rows are non-interactive at the row level; the
    // outer wrapper (data-selectable-row) acts as the click target so
    // the listbox owns selection (option's aria-selected reflects state).
    const rowEl = document.querySelectorAll("[data-selectable-row]")[0];
    fireEvent.click(rowEl as Element);
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

  it("exposes data-virtualized and data-total-rows on the listbox", () => {
    const rows = [row(1, true), row(2, false), row(3, true)];
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
    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("data-virtualized")).toBe("true");
    expect(listbox.getAttribute("data-total-rows")).toBe("3");
  });

  it("keeps the rendered DOM bounded to ~(viewport + overscan) at N=1000 — NOT 1000 rows", () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      row(i + 1, i % 2 === 0),
    );
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
    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("data-total-rows")).toBe("1000");
    // Viewport 400 / row 76 ≈ 5 visible + overscan 8 above & below = ~21.
    // Use ≤ 30 as a robustness bound (plan-02 acceptance criterion).
    const options = document.querySelectorAll('[role="option"]');
    expect(options.length).toBeLessThanOrEqual(30);
    expect(options.length).toBeGreaterThan(0);
    // data-visible-rows agrees with the actual DOM count.
    const visibleRowsAttr = Number(listbox.getAttribute("data-visible-rows"));
    expect(visibleRowsAttr).toBe(options.length);
  });

  it("updates data-total-rows when the rows prop changes (filter-like)", () => {
    const initial = [row(1, true), row(2, false), row(3, true)];
    const { rerender } = render(
      <SourcesPanelList
        jobId={job}
        rows={initial}
        matches={new Map()}
        query=""
        activeDescendantId={null}
        emptyState={<p>empty</p>}
      />,
    );
    expect(screen.getByRole("listbox").getAttribute("data-total-rows")).toBe(
      "3",
    );
    rerender(
      <SourcesPanelList
        jobId={job}
        rows={[row(1, true)]}
        matches={new Map()}
        query=""
        activeDescendantId={null}
        emptyState={<p>empty</p>}
      />,
    );
    expect(screen.getByRole("listbox").getAttribute("data-total-rows")).toBe(
      "1",
    );
  });

  it("preserves data-paper-source and data-paper-included on every rendered row", () => {
    const rows = [
      { ...row(1, true), sourceType: "openalex" as const },
      { ...row(2, false), sourceType: "zotero" as const },
    ];
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
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    expect(options.length).toBe(2);
    for (const o of options) {
      expect(o.getAttribute("data-paper-source")).not.toBeNull();
      expect(o.getAttribute("data-paper-included")).not.toBeNull();
      expect(o.getAttribute("aria-setsize")).toBe("2");
    }
    expect(options[0].getAttribute("aria-posinset")).toBe("1");
    expect(options[1].getAttribute("aria-posinset")).toBe("2");
  });

  it("defaults data-search-deferred to 'false' on the listbox when isSearchStale is unset", () => {
    render(
      <SourcesPanelList
        jobId={job}
        rows={[row(1, true)]}
        matches={new Map()}
        query=""
        activeDescendantId={null}
        emptyState={<p>empty</p>}
      />,
    );
    expect(
      screen.getByRole("listbox").getAttribute("data-search-deferred"),
    ).toBe("false");
  });

  it("forwards isSearchStale=true to data-search-deferred='true' on the listbox", () => {
    render(
      <SourcesPanelList
        jobId={job}
        rows={[row(1, true)]}
        matches={new Map()}
        query=""
        activeDescendantId={null}
        emptyState={<p>empty</p>}
        isSearchStale={true}
      />,
    );
    expect(
      screen.getByRole("listbox").getAttribute("data-search-deferred"),
    ).toBe("true");
  });

  it("transitions data-search-deferred from 'true' back to 'false' on the listbox when isSearchStale clears", () => {
    const rows = [row(1, true), row(2, false)];
    const { rerender } = render(
      <SourcesPanelList
        jobId={job}
        rows={rows}
        matches={new Map()}
        query=""
        activeDescendantId={null}
        emptyState={<p>empty</p>}
        isSearchStale={true}
      />,
    );
    expect(
      screen.getByRole("listbox").getAttribute("data-search-deferred"),
    ).toBe("true");
    rerender(
      <SourcesPanelList
        jobId={job}
        rows={rows}
        matches={new Map()}
        query=""
        activeDescendantId={null}
        emptyState={<p>empty</p>}
        isSearchStale={false}
      />,
    );
    expect(
      screen.getByRole("listbox").getAttribute("data-search-deferred"),
    ).toBe("false");
  });
});
