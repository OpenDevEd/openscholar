/**
 * @vitest-environment jsdom
 *
 * Parity test: mobile <BucketDrawer> adopts the same SourceChip + row
 * layout as the desktop sidebar after T9.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { useBucketStore } from "@/lib/store/bucket";
import { BucketDrawer } from "@/components/extraction/bucket/bucket-drawer";
import { BucketIndicator } from "@/components/extraction/bucket/bucket-indicator";

vi.mock("convex/react", () => ({
  useQuery: () => 1000,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    extraction: {
      bucket: {
        queries: { getMyPaperLimit: "stub" },
      },
    },
  },
}));

function makeItem(
  key: string,
  title: string,
  overrides: Partial<BucketItem> = {},
): BucketItem {
  return {
    bucketKey: key,
    source: "library",
    sourceRefId: key,
    title,
    authors: [],
    addedAt: 1,
    status: "ready",
    ...overrides,
  };
}

function withProviders(ui: React.ReactElement) {
  return <TooltipProvider>{ui}</TooltipProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  useBucketStore.getState().clear();
});

afterEach(() => {
  useBucketStore.getState().clear();
});

describe("<BucketDrawer> row parity with sidebar", () => {
  it("renders SourceChip (dot + lib label) for each staged item", () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha", { source: "collection" })],
          1000,
        );
    });
    render(withProviders(<BucketDrawer open={true} onOpenChange={() => {}} />));
    // Lib canonical label is "Collections" (plural); stale local
    // `"Collection"` (singular) no longer exists.
    expect(screen.getByText("Collections")).toBeTruthy();
    expect(screen.queryByText(/^Collection$/)).toBeNull();
  });

  it("renders source labels from BUCKET_SOURCE_LABELS for each source", () => {
    const items: BucketItem[] = [
      makeItem("k:h", "H", { source: "history" }),
      makeItem("k:l", "L", { source: "library" }),
      makeItem("k:c", "C", { source: "collection" }),
      makeItem("k:z", "Z", { source: "zotero" }),
      makeItem("k:u", "U", { source: "upload" }),
    ];
    act(() => {
      useBucketStore.getState().addMany(items, 1000);
    });
    render(withProviders(<BucketDrawer open={true} onOpenChange={() => {}} />));
    for (const label of [
      "History",
      "Library",
      "Collections",
      "Zotero",
      "Upload",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});

describe("<BucketIndicator> (mobile) — T9 tint replaces badges", () => {
  it("no badges when under the cap threshold", () => {
    act(() => {
      useBucketStore.getState().addMany([makeItem("k:a", "Alpha")], 1000);
    });
    render(withProviders(<BucketIndicator onClick={() => {}} />));
    expect(screen.queryByText(/near cap/i)).toBeNull();
    expect(screen.queryByText(/at cap/i)).toBeNull();
  });

  it("no 'near cap' badge at nearCap, tint applies to count", () => {
    const items: BucketItem[] = Array.from({ length: 950 }, (_, i) =>
      makeItem(`k:${i}`, `Paper ${i}`),
    );
    act(() => {
      useBucketStore.getState().addMany(items, 1000);
    });
    render(withProviders(<BucketIndicator onClick={() => {}} />));
    expect(screen.queryByText(/near cap/i)).toBeNull();
  });

  it("no 'at cap' badge at cap, indicator stays a single button", () => {
    const items: BucketItem[] = Array.from({ length: 1000 }, (_, i) =>
      makeItem(`k:${i}`, `Paper ${i}`),
    );
    act(() => {
      useBucketStore.getState().addMany(items, 1000);
    });
    render(withProviders(<BucketIndicator onClick={() => {}} />));
    expect(screen.queryByText(/at cap/i)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
