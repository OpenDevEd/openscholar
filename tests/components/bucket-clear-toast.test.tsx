/**
 * @vitest-environment jsdom
 *
 * Clear-all undo flow for both surfaces:
 * - Desktop `<BucketSidebar>`: Clear button shows Sonner toast; Undo restores.
 * - Mobile `<BucketDrawer>`: AlertDialog gone; Clear goes straight to toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { useBucketSidebarStore } from "@/lib/store";
import { useBucketStore } from "@/lib/store/bucket";
import { BucketSidebar } from "@/components/extraction/bucket/bucket-sidebar";
import { BucketDrawer } from "@/components/extraction/bucket/bucket-drawer";

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

function withProviders(ui: React.ReactElement) {
  return (
    <TooltipProvider>
      {ui}
      <Toaster />
    </TooltipProvider>
  );
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

describe("<BucketSidebar> Clear-all undo flow", () => {
  it("Clear-all shows a Sonner toast with an Undo action", async () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [
            makeItem("k:a", "Alpha"),
            makeItem("k:b", "Beta"),
            makeItem("k:c", "Gamma"),
          ],
          1000,
        );
    });
    render(withProviders(<BucketSidebar />));
    fireEvent.click(screen.getByRole("button", { name: /^clear all$/i }));

    await waitFor(() => {
      expect(screen.getByText(/cleared 3 papers/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /^undo$/i })).toBeTruthy();
  });

  it("clicking Undo restores the snapshot", async () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha"), makeItem("k:b", "Beta")],
          1000,
        );
    });
    render(withProviders(<BucketSidebar />));
    fireEvent.click(screen.getByRole("button", { name: /^clear all$/i }));
    expect(useBucketStore.getState().order).toEqual([]);

    const undo = await screen.findByRole("button", { name: /^undo$/i });
    fireEvent.click(undo);
    expect(useBucketStore.getState().order).toEqual(["k:a", "k:b"]);
  });
});

describe("<BucketDrawer> mobile Clear-all flow", () => {
  it("Clear-all in the drawer shows the same Sonner toast", async () => {
    setMobileMatchMedia(true);
    act(() => {
      useBucketStore
        .getState()
        .addMany([makeItem("k:a", "Alpha")], 1000);
    });
    render(
      withProviders(<BucketDrawer open={true} onOpenChange={() => {}} />),
    );
    fireEvent.click(screen.getByRole("button", { name: /^clear all$/i }));
    await waitFor(() => {
      expect(screen.getByText(/cleared 1 paper/i)).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /^undo$/i })).toBeTruthy();
  });
});
