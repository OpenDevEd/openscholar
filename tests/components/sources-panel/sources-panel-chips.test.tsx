/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for <SourcesPanelChips>.
 *
 * Asserts on the user-observable contract:
 * - the visible chip set is { all, openalex, upload, zotero, history }
 *   (the 'unknown' bucket is intentionally hidden from the UI even when
 *   its count > 0)
 * - each chip surfaces its current count via data-chip-count and the
 *   visible label
 * - chips with count==0 (other than 'all') are aria-disabled and
 *   non-clickable
 * - clicking a chip fires onSelect with the chip name
 * - the active chip exposes data-active='true' for higher-level scopes
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SourcesPanelChips } from "@/components/extraction/chat/sources-panel/sources-panel-chips";
import type { ChipCounts, SourceChip } from "@/lib/chat/source-chips";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const counts = (over: Partial<ChipCounts> = {}): ChipCounts => ({
  all: 10,
  openalex: 5,
  upload: 3,
  zotero: 2,
  history: 0,
  unknown: 1,
  ...over,
});

describe("<SourcesPanelChips>", () => {
  it("renders the five visible chips and hides the 'unknown' bucket", () => {
    render(
      <SourcesPanelChips
        counts={counts()}
        selected={"all" as SourceChip}
        onSelect={vi.fn()}
      />,
    );
    expect(document.querySelector("[data-source-chip-button='all']")).not.toBeNull();
    expect(document.querySelector("[data-source-chip-button='openalex']")).not.toBeNull();
    expect(document.querySelector("[data-source-chip-button='upload']")).not.toBeNull();
    expect(document.querySelector("[data-source-chip-button='zotero']")).not.toBeNull();
    expect(document.querySelector("[data-source-chip-button='history']")).not.toBeNull();
    expect(document.querySelector("[data-source-chip-button='unknown']")).toBeNull();
  });

  it("renders each chip's count via data-chip-count and label", () => {
    render(
      <SourcesPanelChips
        counts={counts()}
        selected={"all" as SourceChip}
        onSelect={vi.fn()}
      />,
    );
    const openalex = document.querySelector(
      "[data-source-chip-button='openalex']",
    );
    expect(openalex?.getAttribute("data-chip-count")).toBe("5");
    expect(openalex?.textContent).toContain("(5)");
  });

  it("disables a chip whose count is 0 (other than 'all') and exposes aria-disabled", () => {
    const onSelect = vi.fn();
    render(
      <SourcesPanelChips
        counts={counts()}
        selected={"all" as SourceChip}
        onSelect={onSelect}
      />,
    );
    const history = document.querySelector(
      "[data-source-chip-button='history']",
    );
    expect(history?.getAttribute("aria-disabled")).toBe("true");
    expect(history?.hasAttribute("disabled")).toBe(true);
  });

  it("clicking an enabled chip fires onSelect with the chip name", () => {
    const onSelect = vi.fn();
    render(
      <SourcesPanelChips
        counts={counts()}
        selected={"all" as SourceChip}
        onSelect={onSelect}
      />,
    );
    const upload = document.querySelector(
      "[data-source-chip-button='upload']",
    );
    fireEvent.click(upload as Element);
    expect(onSelect).toHaveBeenCalledWith("upload");
  });

  it("the active chip exposes data-active='true'", () => {
    render(
      <SourcesPanelChips
        counts={counts()}
        selected={"openalex" as SourceChip}
        onSelect={vi.fn()}
      />,
    );
    const openalex = document.querySelector(
      "[data-source-chip-button='openalex']",
    );
    expect(openalex?.getAttribute("data-active")).toBe("true");
    const all = document.querySelector("[data-source-chip-button='all']");
    expect(all?.getAttribute("data-active")).toBeNull();
  });
});
