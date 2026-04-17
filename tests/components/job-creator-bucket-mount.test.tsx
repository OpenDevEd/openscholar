/**
 * @vitest-environment jsdom
 *
 * P6 Task 1: the bucket indicator + drawer pair is mounted where
 * <JobCreator> mounts them — in a shared header/root. This test renders a
 * minimal harness that mirrors that mount pattern so the wiring
 * (indicator click → drawer open → per-item remove) is covered without
 * bringing the full wizard's Convex + next-intl + nuqs deps into scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { useBucketStore } from "@/lib/store/bucket";
import { BucketIndicator } from "@/components/extraction/bucket/bucket-indicator";
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

function Harness() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <BucketIndicator ref={ref} onClick={() => setOpen(true)} />
      <BucketDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}

beforeEach(() => {
  useBucketStore.getState().clear();
  window.localStorage.clear();
});

afterEach(() => {
  useBucketStore.getState().clear();
});

describe("Bucket UI mount (P6 T1)", () => {
  it("indicator renders the live ready-count against the cap", () => {
    render(<Harness />);
    expect(screen.getByText(/0 \/ 1000/)).toBeTruthy();

    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha Paper"), makeItem("k:b", "Beta Paper")],
          1000,
        );
    });

    expect(screen.getByText(/2 \/ 1000/)).toBeTruthy();
  });

  it("clicking the indicator opens the drawer and lists staged items", () => {
    render(<Harness />);
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha Paper"), makeItem("k:b", "Beta Paper")],
          1000,
        );
    });

    const indicator = screen.getByRole("button", { name: /Open bucket/ });
    fireEvent.click(indicator);

    expect(screen.getByText("Alpha Paper")).toBeTruthy();
    expect(screen.getByText("Beta Paper")).toBeTruthy();
  });

  it("per-item Remove button in the drawer removes from the store", () => {
    render(<Harness />);
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha Paper"), makeItem("k:b", "Beta Paper")],
          1000,
        );
    });

    fireEvent.click(screen.getByRole("button", { name: /Open bucket/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Remove Alpha Paper/ }),
    );

    expect(useBucketStore.getState().order).toEqual(["k:b"]);
  });

  it("<BucketIndicator> forwards the ref to the underlying button", () => {
    let captured: HTMLButtonElement | null = null;
    function Capture() {
      const ref = useRef<HTMLButtonElement>(null);
      captured = ref.current ?? captured;
      return <BucketIndicator ref={ref} onClick={() => undefined} />;
    }
    const { rerender } = render(<Capture />);
    rerender(<Capture />);
    expect(captured).not.toBeNull();
    expect(captured!.tagName).toBe("BUTTON");
  });

  it("indicator exposes an aria-live region mirroring the ready count", () => {
    render(<Harness />);
    act(() => {
      useBucketStore
        .getState()
        .addMany(
          [makeItem("k:a", "Alpha Paper"), makeItem("k:b", "Beta Paper")],
          1000,
        );
    });
    const live = document.querySelector(
      "[aria-live='polite']",
    ) as HTMLElement | null;
    expect(live).not.toBeNull();
    expect(live!.textContent).toContain("2 of 1000 papers staged");
  });

  it("Clear-all invokes onClearReturnFocus after confirmation", () => {
    const onClearReturnFocus = vi.fn();
    function LocalHarness() {
      const [open, setOpen] = useState(true);
      return (
        <BucketDrawer
          open={open}
          onOpenChange={setOpen}
          onClearReturnFocus={onClearReturnFocus}
        />
      );
    }
    act(() => {
      useBucketStore
        .getState()
        .addMany([makeItem("k:a", "Alpha Paper")], 1000);
    });
    render(<LocalHarness />);
    fireEvent.click(screen.getByRole("button", { name: /Clear all/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Clear bucket$/ }));
    expect(onClearReturnFocus).toHaveBeenCalledTimes(1);
    expect(useBucketStore.getState().order).toEqual([]);
  });
});
