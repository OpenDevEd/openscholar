/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <SourcesPanelSheet>.
 *
 * Asserts on the user-observable contract:
 * - on desktop (matchMedia false), the trigger is suppressed
 * - on mobile (matchMedia true), the trigger renders with
 *   data-sources-trigger and an N/M counter from
 *   listChatSourcesWithInclusion
 *
 * Mocks the inner <SourcesPanelInner> so this test stays focused on
 * the trigger surface; the inner-panel contract is covered elsewhere.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";
import type { Id } from "@/convex/_generated/dataModel";
import { PapersContext } from "@/components/extraction/chat/papers-context";
import {
  fakePapersContext,
  mkChatSourceRow,
} from "@/tests/helpers/papers-context-fixture";
import { installJsdomVirtualizerStubs } from "@/tests/helpers/jsdom-virtualizer";

vi.mock("convex/react", () => ({
  useMutation: () => {
    const fn = vi.fn();
    Object.assign(fn, { withOptimisticUpdate: () => fn });
    return fn;
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    chat: {
      chatPapers: {
        listChatSourcesWithInclusion: "stub:listChatSourcesWithInclusion",
        toggleChatPaper: "stub:toggleChatPaper",
        bulkSetChatPapers: "stub:bulkSetChatPapers",
      },
    },
  },
}));

vi.mock("nuqs", async () => {
  const actual = await vi.importActual<typeof import("nuqs")>("nuqs");
  return {
    ...actual,
    useQueryStates: () => [
      { q: "", sort: "added", dir: "asc", src: "all" },
      () => Promise.resolve(),
    ],
  };
});

vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, { error: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    `${key}|${JSON.stringify(params ?? {})}`,
}));

let isMobileResult = false;
vi.mock("@/lib/hooks", () => ({
  useIsMobile: () => isMobileResult,
  useMediaQuery: () => false,
}));

// Intentionally NOT mocking "sources-panel" here: the mobile sheet's
// whole value is that it mounts the real SourcesPanelInner (and therefore
// the virtualized list) on mobile. The virtualizer-integration test
// below asserts against the real tree. The pre-existing trigger tests
// below use the fake mobile path and don't depend on SourcesPanelInner
// rendering anything specific.

import { SourcesPanelSheet } from "@/components/extraction/chat/sources-panel/sources-panel-sheet";

const job = "job1" as unknown as Id<"extractionJobs">;

let restoreLayoutStubs: () => void;
beforeEach(() => {
  restoreLayoutStubs = installJsdomVirtualizerStubs();
});
afterEach(() => {
  restoreLayoutStubs();
});

describe("<SourcesPanelSheet>", () => {
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  function renderSheet() {
    const rows = [
      mkChatSourceRow({
        jobId: job,
        chatPaperId: "cp1" as unknown as Id<"chatPapers">,
        sourceId: "src1" as unknown as Id<"extractionJobSources">,
        position: 1,
        included: true,
      }),
      mkChatSourceRow({
        jobId: job,
        chatPaperId: "cp2" as unknown as Id<"chatPapers">,
        sourceId: "src2" as unknown as Id<"extractionJobSources">,
        position: 2,
        included: false,
      }),
      mkChatSourceRow({
        jobId: job,
        chatPaperId: "cp3" as unknown as Id<"chatPapers">,
        sourceId: "src3" as unknown as Id<"extractionJobSources">,
        position: 3,
        included: true,
      }),
    ];
    return render(
      <PapersContext.Provider value={fakePapersContext({ jobId: job, rows })}>
        <SourcesPanelSheet jobId={job} />
      </PapersContext.Provider>,
    );
  }

  it("renders nothing on desktop (useIsMobile=false)", () => {
    isMobileResult = false;
    const { container } = renderSheet();
    expect(container.querySelector("[data-sources-trigger]")).toBeNull();
  });

  it("renders the trigger on mobile with the N/M counter from the query", () => {
    isMobileResult = true;
    renderSheet();
    const trigger = document.querySelector("[data-sources-trigger]");
    expect(trigger).not.toBeNull();
    // Trigger label encodes the count parameters; assert the N/M shape.
    expect(trigger?.textContent).toContain("\"included\":2");
    expect(trigger?.textContent).toContain("\"total\":3");
  });

  it("opens the sheet and renders the virtualized listbox on mobile", () => {
    isMobileResult = true;
    renderSheet();
    const trigger = document.querySelector("[data-sources-trigger]");
    fireEvent.click(trigger as Element);
    // The real SourcesPanelInner mounts inside the SheetContent; its list
    // exposes the same virtualization contracts as the desktop rail.
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute("data-virtualized")).toBe("true");
    expect(listbox?.getAttribute("data-total-rows")).toBe("3");
  });
});
