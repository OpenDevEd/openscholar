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
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";

vi.mock("convex/react", () => ({
  useQuery: () => [
    { included: true, chatPaperId: "cp1" },
    { included: false, chatPaperId: "cp2" },
    { included: true, chatPaperId: "cp3" },
  ],
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
      },
    },
  },
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

vi.mock(
  "@/components/extraction/chat/sources-panel/sources-panel",
  () => ({
    SourcesPanel: () => <div data-testid="desktop-rail" />,
    SourcesPanelInner: () => <div data-testid="inner-panel" />,
  }),
);

import { SourcesPanelSheet } from "@/components/extraction/chat/sources-panel/sources-panel-sheet";

const job = "job1" as unknown as Id<"extractionJobs">;

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

  it("renders nothing on desktop (useIsMobile=false)", () => {
    isMobileResult = false;
    const { container } = render(<SourcesPanelSheet jobId={job} />);
    expect(container.querySelector("[data-sources-trigger]")).toBeNull();
  });

  it("renders the trigger on mobile with the N/M counter from the query", () => {
    isMobileResult = true;
    render(<SourcesPanelSheet jobId={job} />);
    const trigger = document.querySelector("[data-sources-trigger]");
    expect(trigger).not.toBeNull();
    // Trigger label encodes the count parameters; assert the N/M shape.
    expect(trigger?.textContent).toContain("\"included\":2");
    expect(trigger?.textContent).toContain("\"total\":3");
  });
});
