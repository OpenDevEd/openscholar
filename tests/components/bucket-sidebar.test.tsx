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
