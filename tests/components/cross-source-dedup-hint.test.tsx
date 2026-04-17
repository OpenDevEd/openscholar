/**
 * @vitest-environment jsdom
 *
 * T9.2: cross-source "also staged from X" hint. Renders a minimal
 * harness that mirrors the three source tabs' wiring (subscribe to
 * dedupeKeys + dedupeKeyToSource, compute weak key per row, render a
 * muted badge when the row is not staged under its own bucketKey but
 * its weak key matches another source). The three tabs — Library,
 * Collections, Zotero — use the same pattern; the full component tree
 * of each would need Convex + SWR + next-intl mocks, so we test the
 * shared logic here instead.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { BucketSource } from "@/lib/bucket/bucketItem";
import { useBucketStore } from "@/lib/store/bucket";
import { buildDedupeKey } from "@/lib/bucket/dedupe";
import { BUCKET_SOURCE_LABELS } from "@/lib/bucket/source-labels";

type Row = {
  bucketKey: string;
  doi?: string;
  title: string;
  year?: number;
};

function LibraryLikeHarness({ row }: { row: Row }) {
  const order = useBucketStore((s) => s.order);
  const dedupeKeys = useBucketStore((s) => s.dedupeKeys);
  const dedupeKeyToSource = useBucketStore((s) => s.dedupeKeyToSource);
  const bucketKeys = new Set(order);

  const alsoStagedFrom = (): BucketSource | null => {
    if (bucketKeys.has(row.bucketKey)) return null;
    try {
      const weak = buildDedupeKey({
        doi: row.doi,
        title: row.title,
        year: row.year,
      });
      if (!dedupeKeys.has(weak)) return null;
      const src = dedupeKeyToSource[weak];
      return src && src !== "library" ? src : null;
    } catch {
      return null;
    }
  };

  const hint = alsoStagedFrom();
  return (
    <div>
      <span>{row.title}</span>
      {hint && <span data-testid="hint">Also staged from {BUCKET_SOURCE_LABELS[hint]}</span>}
    </div>
  );
}

beforeEach(() => {
  useBucketStore.getState().clear();
  window.localStorage.clear();
});

afterEach(() => {
  useBucketStore.getState().clear();
});

describe("cross-source dedup hint (T9.2)", () => {
  it("renders nothing when no cross-source match exists", () => {
    render(
      <LibraryLikeHarness
        row={{
          bucketKey: "openalex:W1",
          doi: "10.1/a",
          title: "Alpha",
          year: 2020,
        }}
      />,
    );
    expect(screen.queryByTestId("hint")).toBeNull();
  });

  it("surfaces 'Also staged from Zotero' when a Zotero item shares the DOI", () => {
    act(() => {
      useBucketStore.getState().addMany(
        [
          {
            bucketKey: "doi:10.1/a",
            source: "zotero",
            sourceRefId: "z1",
            title: "Alpha",
            authors: [],
            year: 2020,
            doi: "10.1/a",
            addedAt: 1,
            status: "ready",
          },
        ],
        1000,
      );
    });
    render(
      <LibraryLikeHarness
        row={{
          // Library keys on openalexId — differs from Zotero's doi: key.
          bucketKey: "openalex:W1",
          doi: "10.1/a",
          title: "Alpha",
          year: 2020,
        }}
      />,
    );
    const hint = screen.getByTestId("hint");
    expect(hint.textContent).toBe("Also staged from Zotero");
  });

  it("hides the hint when the library row is itself staged", () => {
    act(() => {
      useBucketStore.getState().addMany(
        [
          {
            bucketKey: "openalex:W1",
            source: "library",
            sourceRefId: "l1",
            title: "Alpha",
            authors: [],
            year: 2020,
            doi: "10.1/a",
            addedAt: 1,
            status: "ready",
          },
        ],
        1000,
      );
    });
    render(
      <LibraryLikeHarness
        row={{
          bucketKey: "openalex:W1",
          doi: "10.1/a",
          title: "Alpha",
          year: 2020,
        }}
      />,
    );
    expect(screen.queryByTestId("hint")).toBeNull();
  });

  it("skips hints for same-source staging (library→library)", () => {
    // A different library item that happens to share a title+year with
    // another library item shouldn't flag itself as "also staged from
    // Library" — it's the same source.
    act(() => {
      useBucketStore.getState().addMany(
        [
          {
            bucketKey: "openalex:W9",
            source: "library",
            sourceRefId: "l9",
            title: "Shared Title",
            authors: [],
            year: 2020,
            addedAt: 1,
            status: "ready",
          },
        ],
        1000,
      );
    });
    render(
      <LibraryLikeHarness
        row={{
          bucketKey: "openalex:W10",
          title: "Shared Title",
          year: 2020,
        }}
      />,
    );
    expect(screen.queryByTestId("hint")).toBeNull();
  });

  it("hint updates live when the bucket changes", () => {
    const { rerender } = render(
      <LibraryLikeHarness
        row={{
          bucketKey: "openalex:W1",
          doi: "10.1/a",
          title: "Alpha",
          year: 2020,
        }}
      />,
    );
    expect(screen.queryByTestId("hint")).toBeNull();
    act(() => {
      useBucketStore.getState().addMany(
        [
          {
            bucketKey: "doi:10.1/a",
            source: "zotero",
            sourceRefId: "z1",
            title: "Alpha",
            authors: [],
            year: 2020,
            doi: "10.1/a",
            addedAt: 1,
            status: "ready",
          },
        ],
        1000,
      );
    });
    rerender(
      <LibraryLikeHarness
        row={{
          bucketKey: "openalex:W1",
          doi: "10.1/a",
          title: "Alpha",
          year: 2020,
        }}
      />,
    );
    expect(screen.getByTestId("hint").textContent).toBe(
      "Also staged from Zotero",
    );
  });
});
