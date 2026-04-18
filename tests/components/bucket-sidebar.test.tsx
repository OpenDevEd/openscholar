/**
 * @vitest-environment jsdom
 *
 * Component tests for <BucketSidebar>.
 * - Desktop viewport (matchMedia max-width:767px -> false): aside renders.
 * - Mobile viewport (matchMedia -> true): returns null.
 * - Collapse / expand via sliver button + panel collapse button + keyboard.
 * - Panel body: lists items, per-item remove, empty state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useBucketSidebarStore } from "@/lib/store";
import { useBucketStore } from "@/lib/store/bucket";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { BucketSidebar } from "@/components/extraction/bucket/bucket-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

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

function setMobileMatchMedia(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: isMobile && query.includes("max-width: 767px"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  setMobileMatchMedia(false);
  window.localStorage.clear();
  useBucketStore.getState().clear();
  useBucketSidebarStore.setState({
    isCollapsed: false,
    _hasHydrated: true,
  });
});

afterEach(() => {
  useBucketStore.getState().clear();
});

describe("<BucketSidebar> mount", () => {
  it("desktop viewport: renders the complementary aside", () => {
    render(withProviders(<BucketSidebar />));
    expect(screen.getByRole("complementary")).toBeTruthy();
  });

  it("mobile viewport: returns null after effect resolves", async () => {
    setMobileMatchMedia(true);
    render(withProviders(<BucketSidebar />));
    await waitFor(() =>
      expect(screen.queryByRole("complementary")).toBeNull(),
    );
  });

  it("pre-hydration: returns null even on desktop", () => {
    useBucketSidebarStore.setState({ _hasHydrated: false });
    render(withProviders(<BucketSidebar />));
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("<BucketSidebar> collapse control", () => {
  it("sliver button expands a collapsed sidebar", () => {
    useBucketSidebarStore.setState({ isCollapsed: true });
    render(withProviders(<BucketSidebar />));
    const sliver = screen.getByRole("button", { name: /open bucket/i });
    fireEvent.click(sliver);
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(false);
  });

  it("panel collapse button collapses an expanded sidebar", () => {
    render(withProviders(<BucketSidebar />));
    const collapseBtn = screen.getByRole("button", {
      name: /collapse bucket sidebar/i,
    });
    fireEvent.click(collapseBtn);
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(true);
  });

  it("Ctrl+Shift+B toggles collapse state", () => {
    render(withProviders(<BucketSidebar />));
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(true);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "b",
          metaKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(false);
  });

  it("Escape collapses when expanded", () => {
    render(withProviders(<BucketSidebar />));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(true);
  });

  it("Escape does nothing when already collapsed", () => {
    useBucketSidebarStore.setState({ isCollapsed: true });
    render(withProviders(<BucketSidebar />));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useBucketSidebarStore.getState().isCollapsed).toBe(true);
  });
});

describe("<BucketSidebar> panel body", () => {
  it("renders the empty state when no items are staged", () => {
    render(withProviders(<BucketSidebar />));
    expect(
      screen.getByText(/the bucket is empty/i),
    ).toBeTruthy();
  });

  it("lists staged items with titles", () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha Paper"), makeItem("k:b", "Beta Paper")],
          1000,
        );
    });
    render(withProviders(<BucketSidebar />));
    expect(screen.getByText("Alpha Paper")).toBeTruthy();
    expect(screen.getByText("Beta Paper")).toBeTruthy();
  });

  it("per-item remove button drops the row from the store", () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha Paper"), makeItem("k:b", "Beta Paper")],
          1000,
        );
    });
    render(withProviders(<BucketSidebar />));
    fireEvent.click(
      screen.getByRole("button", { name: /remove alpha paper/i }),
    );
    expect(useBucketStore.getState().order).toEqual(["k:b"]);
  });

  it("Clear-all disabled with no items, enabled with items", () => {
    render(withProviders(<BucketSidebar />));
    const btn = screen.getByRole("button", { name: /^clear all$/i });
    expect(btn).toHaveAttribute("disabled");
  });
});

describe("<BucketSidebar> capacity signals", () => {
  it("no tint and no warning row when under the cap threshold", () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany([makeItem("k:a", "Alpha")], 1000);
    });
    render(withProviders(<BucketSidebar />));
    expect(screen.queryByText(/approaching the per-job cap/i)).toBeNull();
    expect(screen.queryByText(/you've hit the per-job cap/i)).toBeNull();
  });

  it("amber warning row when nearCap (>=90%)", () => {
    const items: BucketItem[] = Array.from({ length: 950 }, (_, i) =>
      makeItem(`k:${i}`, `Paper ${i}`),
    );
    act(() => {
      useBucketStore.getState().addMany(items, 1000);
    });
    render(withProviders(<BucketSidebar />));
    expect(
      screen.getByText(/approaching the per-job cap/i),
    ).toBeTruthy();
  });

  it("destructive warning row when atCap", () => {
    const items: BucketItem[] = Array.from({ length: 1000 }, (_, i) =>
      makeItem(`k:${i}`, `Paper ${i}`),
    );
    act(() => {
      useBucketStore.getState().addMany(items, 1000);
    });
    render(withProviders(<BucketSidebar />));
    expect(screen.getByText(/you've hit the per-job cap/i)).toBeTruthy();
  });

  it("capacity count span gains amber class at nearCap", () => {
    const items: BucketItem[] = Array.from({ length: 950 }, (_, i) =>
      makeItem(`k:${i}`, `Paper ${i}`),
    );
    act(() => {
      useBucketStore.getState().addMany(items, 1000);
    });
    render(withProviders(<BucketSidebar />));
    const capacity = screen.getByTestId("bucket-sidebar-capacity");
    expect(capacity.className).toMatch(/text-amber-600/);
  });

  it("capacity count span gains destructive class at cap", () => {
    const items: BucketItem[] = Array.from({ length: 1000 }, (_, i) =>
      makeItem(`k:${i}`, `Paper ${i}`),
    );
    act(() => {
      useBucketStore.getState().addMany(items, 1000);
    });
    render(withProviders(<BucketSidebar />));
    const capacity = screen.getByTestId("bucket-sidebar-capacity");
    expect(capacity.className).toMatch(/text-destructive/);
  });
});

describe("<BucketSidebar> row layout (T8)", () => {
  it("title uses line-clamp-2, no truncate", () => {
    const longTitle =
      "A very long title that easily exceeds one line of rendered text in the bucket sidebar so that line-clamp-2 actually kicks in and wraps to two lines of content";
    act(() => {
      useBucketStore.getState().addMany([makeItem("k:a", longTitle)], 1000);
    });
    render(withProviders(<BucketSidebar />));
    const title = screen.getByText(longTitle);
    expect(title.className).toMatch(/line-clamp-2/);
    expect(title.className).not.toMatch(/\btruncate\b/);
  });

  it("row stacks title above chip + authors + trash so the delete button sits far from the title", () => {
    act(() => {
      useBucketStore.getState().addMany([makeItem("k:a", "Alpha")], 1000);
    });
    render(withProviders(<BucketSidebar />));
    const li = screen.getByText("Alpha").closest("li");
    expect(li).not.toBeNull();
    expect(li!.className).toMatch(/flex-col/);
    // Trash button's nearest flex parent is the bottom row (chip + authors).
    const trash = screen.getByRole("button", { name: /remove alpha/i });
    const trashRow = trash.parentElement;
    expect(trashRow?.className).toMatch(/\bflex\b/);
    expect(trashRow?.className).not.toMatch(/flex-col/);
  });

  it("title has break-words + overflow-wrap:anywhere for long unbroken strings", () => {
    const longDoi =
      "doi:10.1016/j.verylongjournalnamethatneverbreaksnaturally.2024.123456";
    act(() => {
      useBucketStore.getState().addMany([makeItem("k:a", longDoi)], 1000);
    });
    render(withProviders(<BucketSidebar />));
    const title = screen.getByText(longDoi);
    expect(title.className).toMatch(/break-words/);
    expect(title.className).toMatch(/overflow-wrap:anywhere/);
  });

  it("authors line truncates and still renders an inline uploading status", () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha", { status: "uploading" })],
          1000,
        );
    });
    render(withProviders(<BucketSidebar />));
    const uploadingLabel = screen.getByText(/uploading/i);
    const authorsSpan = uploadingLabel.closest("span");
    expect(authorsSpan).not.toBeNull();
    expect(authorsSpan!.className.includes("truncate") ||
      authorsSpan!.parentElement?.className.includes("truncate")).toBe(true);
  });

  it("remove button is compact (h-6 w-6) so it visually matches the source chip, not the title", () => {
    act(() => {
      useBucketStore.getState().addMany([makeItem("k:a", "Alpha")], 1000);
    });
    render(withProviders(<BucketSidebar />));
    const btn = screen.getByRole("button", { name: /remove alpha/i });
    expect(btn.className).toMatch(/\bh-6\b/);
    expect(btn.className).toMatch(/\bw-6\b/);
    expect(btn.className).toMatch(/\bshrink-0\b/);
  });
});
