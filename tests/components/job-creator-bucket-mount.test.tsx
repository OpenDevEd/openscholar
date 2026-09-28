/**
 * @vitest-environment jsdom
 *
 * P8 Task 10: the bucket mount boundary differs by viewport.
 * - Mobile (<768 px): header <BucketIndicator> + right-edge Vaul drawer.
 * - Desktop (>=768 px): the indicator + drawer are hidden; the
 *   <BucketSidebar> owns the feature.
 *
 * `<JobCreator>` itself carries Convex + next-intl + nuqs deps that
 * don't belong in a jsdom unit test, so we mirror its exact mount
 * boundary in a minimal harness (`isMobile && <Indicator/>` +
 * `isMobile && <Drawer />` + `<Sidebar />`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { useBucketStore } from "@/lib/store/bucket";
import { useBucketSidebarStore } from "@/lib/store";
import { BucketIndicator } from "@/components/extraction/bucket/bucket-indicator";
import { BucketDrawer } from "@/components/extraction/bucket/bucket-drawer";
import { BucketSidebar } from "@/components/extraction/bucket/bucket-sidebar";
import { useIsMobile } from "@/lib/hooks";

vi.mock("convex/react", () => ({
  useQuery: () => 1000,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    extraction: {
    },
  },
}));

function makeItem(key: string, title: string): BucketItem {
  return {
    bucketKey: key,
    source: "library",
    sourceRefId: key,
    title,
    authors: [],
    addedAt: 1,
    status: "ready",
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

/**
 * Mirrors `job-creator.tsx` mount:
 * - mobile-only `<BucketIndicator>` + `<BucketDrawer>`
 * - `<BucketSidebar>` (self-hides on mobile)
 */
function JobCreatorHarness() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();
  return (
    <TooltipProvider>
      {isMobile && (
        <BucketIndicator ref={ref} onClick={() => setOpen(true)} />
      )}
      {isMobile && (
        <BucketDrawer
          open={open}
          onOpenChange={setOpen}
          onClearReturnFocus={() => ref.current?.focus()}
        />
      )}
      <BucketSidebar />
      <Toaster />
    </TooltipProvider>
  );
}

beforeEach(() => {
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

describe("Bucket mount — desktop viewport", () => {
  beforeEach(() => setMobileMatchMedia(false));

  it("renders <BucketSidebar> (role=complementary)", () => {
    render(<JobCreatorHarness />);
    expect(screen.getByRole("complementary")).toBeTruthy();
  });

  it("does not render the mobile <BucketIndicator> in the header", () => {
    render(<JobCreatorHarness />);
    expect(
      screen.queryByRole("button", { name: /^open bucket —/i }),
    ).toBeNull();
  });

  it("does not mount the mobile <BucketDrawer> dialog", () => {
    render(<JobCreatorHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Clear-all via the sidebar shows the Sonner undo toast", async () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha"), makeItem("k:b", "Beta")],
          1000,
        );
    });
    render(<JobCreatorHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^clear all$/i }));
    await waitFor(() => {
      expect(screen.getByText(/cleared 2 papers/i)).toBeTruthy();
    });

    const undo = await screen.findByRole("button", { name: /^undo$/i });
    fireEvent.click(undo);
    expect(useBucketStore.getState().order).toEqual(["k:a", "k:b"]);
  });
});

describe("Bucket mount — mobile viewport", () => {
  beforeEach(() => setMobileMatchMedia(true));

  it("renders <BucketIndicator> in the header", async () => {
    render(<JobCreatorHarness />);
    const btn = await screen.findByRole("button", { name: /^open bucket —/i });
    expect(btn).toBeTruthy();
  });

  it("indicator click opens the drawer and lists staged items", async () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha"), makeItem("k:b", "Beta")],
          1000,
        );
    });
    render(<JobCreatorHarness />);
    const btn = await screen.findByRole("button", { name: /^open bucket —/i });
    fireEvent.click(btn);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("does not mount <BucketSidebar>", async () => {
    render(<JobCreatorHarness />);
    await waitFor(() => {
      expect(screen.queryByRole("complementary")).toBeNull();
    });
  });

  it("aria-live region mirrors the ready count", () => {
    render(<JobCreatorHarness />);
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha"), makeItem("k:b", "Beta")],
          1000,
        );
    });
    const live = document.querySelector(
      "[aria-live='polite']",
    ) as HTMLElement | null;
    expect(live).not.toBeNull();
    expect(live!.textContent).toContain("2 of 1000 papers staged");
  });

  it("per-item Remove in the drawer drops the row from the store", async () => {
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha"), makeItem("k:b", "Beta")],
          1000,
        );
    });
    render(<JobCreatorHarness />);
    const btn = await screen.findByRole("button", { name: /^open bucket —/i });
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole("button", { name: /^remove alpha$/i }));
    expect(useBucketStore.getState().order).toEqual(["k:b"]);
  });

  it("indicator forwards the ref to the underlying button", async () => {
    let captured: HTMLButtonElement | null = null;
    function Capture() {
      const ref = useRef<HTMLButtonElement>(null);
      captured = ref.current ?? captured;
      return (
        <TooltipProvider>
          <BucketIndicator ref={ref} onClick={() => undefined} />
        </TooltipProvider>
      );
    }
    const { rerender } = render(<Capture />);
    rerender(<Capture />);
    expect(captured).not.toBeNull();
    expect(captured!.tagName).toBe("BUTTON");
  });
});
