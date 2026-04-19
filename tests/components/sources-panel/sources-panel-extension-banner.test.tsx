/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <SourcesPanelExtensionBanner>.
 *
 * Asserts on the user-observable contract:
 * - banner only renders when `visible` AND `visibleCount < totalCount`
 * - clicking the [Include all N sources] button fires
 *   bulkSetChatPapers with sourceIds=undefined and included=true
 *   (backend cue for 'every row')
 * - clicking the dismiss button fires onDismiss
 * - the banner is exposed as role=status with the data attribute the
 *   higher-level tests can scope by
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { SourcesPanelExtensionBanner } from "@/components/extraction/chat/sources-panel/sources-panel-extension-banner";
import type { Id } from "@/convex/_generated/dataModel";

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

const job = "job1" as unknown as Id<"extractionJobs">;

describe("<SourcesPanelExtensionBanner>", () => {
  it("does not render when visible=false", () => {
    const { container } = render(
      <SourcesPanelExtensionBanner
        jobId={job}
        visibleCount={5}
        totalCount={50}
        visible={false}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-sources-extension-banner]")).toBeNull();
  });

  it("does not render when visibleCount >= totalCount (no extension to offer)", () => {
    const { container } = render(
      <SourcesPanelExtensionBanner
        jobId={job}
        visibleCount={50}
        totalCount={50}
        visible={true}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-sources-extension-banner]")).toBeNull();
  });

  it("renders with role=status when visible and there are more rows beyond the filter", () => {
    const { container } = render(
      <SourcesPanelExtensionBanner
        jobId={job}
        visibleCount={5}
        totalCount={50}
        visible={true}
        onDismiss={vi.fn()}
      />,
    );
    const banner = container.querySelector("[data-sources-extension-banner]");
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute("role")).toBe("status");
  });

  it("clicking [Include all] fires bulkSetChatPapers with sourceIds=undefined + included=true", async () => {
    bulkSpy.mockClear();
    bulkSpy.mockResolvedValue(undefined);
    const { container } = render(
      <SourcesPanelExtensionBanner
        jobId={job}
        visibleCount={5}
        totalCount={50}
        visible={true}
        onDismiss={vi.fn()}
      />,
    );
    const includeAll = container.querySelector("[data-banner-include-all]");
    fireEvent.click(includeAll as Element);
    expect(bulkSpy).toHaveBeenCalledWith({
      jobId: job,
      sourceIds: undefined,
      included: true,
    });
  });

  it("clicking dismiss fires onDismiss", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <SourcesPanelExtensionBanner
        jobId={job}
        visibleCount={5}
        totalCount={50}
        visible={true}
        onDismiss={onDismiss}
      />,
    );
    const dismiss = container.querySelector("[data-banner-dismiss]");
    fireEvent.click(dismiss as Element);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
