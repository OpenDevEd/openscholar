/**
 * @vitest-environment jsdom
 *
 * Component tests for <BucketSidebar>.
 * - Desktop viewport (matchMedia max-width:767px -> false): aside renders.
 * - Mobile viewport (matchMedia -> true): returns null.
 * - Collapse / expand via sliver button + panel collapse button + keyboard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useBucketSidebarStore } from "@/lib/store";
import { useBucketStore } from "@/lib/store/bucket";
import { BucketSidebar } from "@/components/extraction/bucket/bucket-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

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
