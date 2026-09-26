/**
 * @vitest-environment jsdom
 *
 * Plan 06 axe audit for the chat-text citation pill.
 *
 * Three cases — one per state in `data-citation-state`:
 *   - included     (resolved, included in next prompt)
 *   - excluded     (resolved, currently excluded — pill stays clickable)
 *   - unresolved   (no live paper at this position)
 *
 * Each case expects zero axe violations on the pill itself. The hover-
 * card surface is portal-rendered and only mounts on hover; closed-
 * state markup is what the audit covers (the open state is already
 * exercised by the per-component behavior tests).
 *
 * Color-contrast disabled: jsdom returns transparent computedStyle for
 * everything, producing false positives. Visual contrast is measured in
 * a real browser per the .a11y trace.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderWithTooltip as render } from "../helpers/render-with-tooltip";
import { axe, toHaveNoViolations } from "jest-axe";
import { PaperCitation } from "@/components/extraction/chat/paper-citation";
import { PapersContext } from "@/components/extraction/chat/papers-context";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";
import type { Id } from "@/convex/_generated/dataModel";
import { fakePapersContext } from "@/tests/helpers/papers-context-fixture";

function renderCitation({
  index,
  paper,
  jobId,
}: {
  index: number;
  paper: ResolvablePaper | null;
  jobId: Id<"extractionJobs">;
}) {
  const papersByPosition = new Map<number, ResolvablePaper>();
  if (paper) papersByPosition.set(index, paper);
  return render(
    <PapersContext.Provider
      value={fakePapersContext({ jobId, papersByPosition })}
    >
      <PaperCitation index={index} />
    </PapersContext.Provider>,
  );
}

expect.extend(toHaveNoViolations);

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
        toggleChatPaper: "toggleChatPaper",
        listChatSourcesWithInclusion: "listChatSourcesWithInclusion",
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, { error: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, string | number>) => {
      if (params?.title) return `${key}:${params.title}`;
      if (params?.index != null) return `${key}:${params.index}`;
      return key;
    },
}));

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
});

const JOB = "job_1" as Id<"extractionJobs">;

const mkPaper = (over: Partial<ResolvablePaper> = {}): ResolvablePaper => ({
  sourceId: "src_1" as Id<"extractionJobSources">,
  chatPaperId: "cp_1" as Id<"chatPapers">,
  position: 3,
  title: "A study of citation behavior",
  authors: ["Doe, J.", "Smith, A."],
  year: 2024,
  abstract: null,
  openalexId: "W1234567890",
  doi: null,
  pdfUrl: null,
  included: true,
  ...over,
});

const AXE_OPTIONS = {
  rules: {
    "color-contrast": { enabled: false },
  },
} as const;

describe("<PaperCitation> a11y audit (plan-06)", () => {
  it("included pill has zero axe violations", async () => {
    const { container } = renderCitation({
      index: 3,
      paper: mkPaper({ included: true }),
      jobId: JOB,
    });
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it("excluded pill has zero axe violations", async () => {
    const { container } = renderCitation({
      index: 3,
      paper: mkPaper({ included: false }),
      jobId: JOB,
    });
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it("unresolved pill has zero axe violations", async () => {
    const { container } = renderCitation({
      index: 9,
      paper: null,
      jobId: JOB,
    });
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
