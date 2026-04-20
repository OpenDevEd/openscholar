/**
 * @vitest-environment jsdom
 *
 * Plan 06 axe audit for the Sources panel.
 *
 * Two passes against the same composed surface:
 *   1) default — `useReducedMotion` returns false
 *   2) reduced — `useReducedMotion` returns true
 *
 * Each pass expects zero axe violations AND confirms the panel's
 * `data-motion-disabled` attribute reflects the gate correctly,
 * proving the contract holds without flipping any a11y signal.
 *
 * The hook is mocked directly — framer-motion's `useReducedMotion`
 * lazily initializes a module-level singleton from `matchMedia` on
 * first read, so toggling matchMedia mid-test doesn't propagate.
 * Real-browser reduced-motion behavior is verified end-to-end via
 * Playwright's `emulateMedia` in the keyboard-only spec.
 *
 * Color-contrast and nested-interactive are disabled here for the same
 * reasons documented in the per-component test (jsdom has no paint
 * engine; the listbox option exposes inner action affordances on hover).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

const reduceMotionRef = { current: false };

vi.mock("motion/react", async () => {
  const actual = await vi.importActual<typeof import("motion/react")>(
    "motion/react",
  );
  return {
    ...actual,
    useReducedMotion: () => reduceMotionRef.current,
  };
});

import { SourcesPanelInner } from "@/components/extraction/chat/sources-panel/sources-panel";
import { PapersContext } from "@/components/extraction/chat/papers-context";
import { fakePapersContext } from "@/tests/helpers/papers-context-fixture";
import type { Id } from "@/convex/_generated/dataModel";

expect.extend(toHaveNoViolations);

const cp = (n: number) => `cp${n}` as unknown as Id<"chatPapers">;
const src = (n: number) => `src${n}` as unknown as Id<"extractionJobSources">;
const job = "job1" as unknown as Id<"extractionJobs">;

const seedRows = [
  {
    chatPaperId: cp(1),
    sourceId: src(1),
    jobId: job,
    position: 1,
    included: true,
    title: "Photosynthesis in marine algae",
    authors: ["Smith, J", "Doe, A"],
    year: 2024,
    abstract: "We examine photosynthesis in marine systems.",
    doi: "10.1234/abc.2024",
    pdfUrl: null,
    openalexId: "W1234567890",
    bucketKey: "openalex:W1234567890",
    sourceType: "openalex" as const,
  },
  {
    chatPaperId: cp(2),
    sourceId: src(2),
    jobId: job,
    position: 2,
    included: false,
    title: "Coral reef biomass dynamics",
    authors: ["Lopez, M"],
    year: 2023,
    abstract: null,
    doi: null,
    pdfUrl: null,
    openalexId: null,
    bucketKey: "zotero:abc",
    sourceType: "zotero" as const,
  },
  {
    chatPaperId: cp(3),
    sourceId: src(3),
    jobId: job,
    position: 3,
    included: true,
    title: "Genome assembly via long-read sequencing",
    authors: [],
    year: null,
    abstract: null,
    doi: null,
    pdfUrl: null,
    openalexId: null,
    bucketKey: "unknown:abc",
    sourceType: "unknown" as const,
  },
];

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
        listChatSourcesWithInclusion: "listChatSourcesWithInclusion",
        toggleChatPaper: "toggleChatPaper",
        bulkSetChatPapers: "bulkSetChatPapers",
      },
    },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

const AXE_OPTIONS = {
  rules: {
    "color-contrast": { enabled: false },
    "nested-interactive": { enabled: false },
  },
} as const;

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

beforeEach(() => {
  reduceMotionRef.current = false;
});

function renderPanel() {
  const ctx = fakePapersContext({ jobId: job, rows: seedRows });
  return render(
    <PapersContext.Provider value={ctx}>
      <SourcesPanelInner jobId={job} />
    </PapersContext.Provider>,
  );
}

describe("<SourcesPanel> a11y audit (plan-06)", () => {
  it("renders zero axe violations with motion enabled", async () => {
    reduceMotionRef.current = false;
    const { container } = renderPanel();
    const panel = container.querySelector("[data-sources-panel]");
    expect(panel?.getAttribute("data-motion-disabled")).toBe("false");
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });

  it("renders zero axe violations and exposes data-motion-disabled when reduced-motion is on", async () => {
    reduceMotionRef.current = true;
    const { container } = renderPanel();
    const panel = container.querySelector("[data-sources-panel]");
    expect(panel?.getAttribute("data-motion-disabled")).toBe("true");
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});
