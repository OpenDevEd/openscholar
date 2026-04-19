/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the shared <BucketPaperRow> used by both the
 * bucket (sidebar/drawer) and the chat papers-in-context list.
 *
 * Asserts on the user-observable contract:
 * - title + author preview render
 * - status surfaces inline as text ("uploading" / "upload failed")
 * - the trash button is present when, and only when, onRemove is provided
 *   (this is the readonly-mode contract the chat reuses)
 * - clicking the trash button calls onRemove exactly once
 * - dataAttrs are forwarded to the <li> for caller-defined contracts
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BucketPaperRow } from "@/components/extraction/bucket/bucket-paper-row";
import type { PaperRowData } from "@/components/extraction/bucket/bucket-paper-row";

function makePaper(over: Partial<PaperRowData> = {}): PaperRowData {
  return {
    title: "A Paper About Things",
    authors: ["Ada Lovelace", "Alan Turing"],
    year: 2024,
    source: "library",
    ...over,
  };
}

describe("<BucketPaperRow>", () => {
  it("renders the title and author preview", () => {
    render(
      <ul>
        <BucketPaperRow paper={makePaper()} />
      </ul>,
    );
    expect(screen.getByText("A Paper About Things")).toBeTruthy();
    expect(screen.getByText(/Ada Lovelace, Alan Turing/)).toBeTruthy();
    expect(screen.getByText(/2024/)).toBeTruthy();
  });

  it("readonly mode: no remove button when onRemove is omitted", () => {
    render(
      <ul>
        <BucketPaperRow paper={makePaper()} />
      </ul>,
    );
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    const li = screen.getByText("A Paper About Things").closest("li");
    expect(li).toHaveAttribute("data-paper-readonly", "true");
  });

  it("interactive mode: shows a remove button labelled with the title", () => {
    const onRemove = vi.fn();
    render(
      <ul>
        <BucketPaperRow paper={makePaper()} onRemove={onRemove} />
      </ul>,
    );
    const btn = screen.getByRole("button", {
      name: /remove a paper about things/i,
    });
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("custom removeLabel overrides the default a11y name", () => {
    render(
      <ul>
        <BucketPaperRow
          paper={makePaper()}
          onRemove={() => {}}
          removeLabel="Drop this source"
        />
      </ul>,
    );
    expect(
      screen.getByRole("button", { name: "Drop this source" }),
    ).toBeTruthy();
  });

  it("uploading status surfaces 'uploading' inline next to the meta line", () => {
    render(
      <ul>
        <BucketPaperRow paper={makePaper({ status: "uploading" })} />
      </ul>,
    );
    expect(screen.getByText(/uploading/i)).toBeTruthy();
    const li = screen.getByText("A Paper About Things").closest("li");
    expect(li).toHaveAttribute("data-paper-status", "uploading");
  });

  it("failed status surfaces 'upload failed' inline next to the meta line", () => {
    render(
      <ul>
        <BucketPaperRow paper={makePaper({ status: "failed" })} />
      </ul>,
    );
    expect(screen.getByText(/upload failed/i)).toBeTruthy();
    const li = screen.getByText("A Paper About Things").closest("li");
    expect(li).toHaveAttribute("data-paper-status", "failed");
  });

  it("forwards dataAttrs to the <li> for caller-defined contracts", () => {
    render(
      <ul>
        <BucketPaperRow
          paper={makePaper()}
          dataAttrs={{ "data-paper-id": "src_42" }}
        />
      </ul>,
    );
    const li = screen.getByText("A Paper About Things").closest("li");
    expect(li).toHaveAttribute("data-paper-id", "src_42");
    expect(li).toHaveAttribute("data-paper-source", "library");
  });

  it("saved-search placeholder: meta line shows '<n> papers' instead of authors", () => {
    render(
      <ul>
        <BucketPaperRow
          paper={makePaper({
            authors: [],
            year: undefined,
            paperCount: 42,
            sourceMeta: { isSavedSearch: true },
          })}
        />
      </ul>,
    );
    expect(screen.getByText(/42 papers/i)).toBeTruthy();
  });

  it("structural invariant: remove button is not nested inside the title element", () => {
    render(
      <ul>
        <BucketPaperRow paper={makePaper()} onRemove={() => {}} />
      </ul>,
    );
    const title = screen.getByText("A Paper About Things");
    const trash = screen.getByRole("button", { name: /remove/i });
    expect(title.contains(trash)).toBe(false);
    expect(trash.contains(title)).toBe(false);
  });
});
