/**
 * @vitest-environment jsdom
 *
 * <SourceChip> — renders the canonical source label and exposes the
 * source as a data-source attribute. The dot's color comes from a CSS
 * variable driven by data-source, so testing the literal inline style
 * would re-state the source-labels constant against itself. The
 * behavioral contract is `data-source={source}` + the visible label.
 */
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceChip } from "@/components/extraction/bucket/source-chip";
import type { BucketSource } from "@/lib/bucket/bucketItem";

const SOURCES: { source: BucketSource; label: string }[] = [
  { source: "history", label: "History" },
  { source: "library", label: "Library" },
  { source: "collection", label: "Collections" },
  { source: "zotero", label: "Zotero" },
  { source: "upload", label: "Upload" },
];

describe("SourceChip", () => {
  for (const { source, label } of SOURCES) {
    test(`renders ${source} with lib-canonical "${label}" label`, () => {
      render(<SourceChip source={source} />);
      expect(screen.getByText(label)).toBeTruthy();
    });

    test(`${source} exposes data-source="${source}" for styling + test hooks`, () => {
      const { container } = render(<SourceChip source={source} />);
      const chip = container.querySelector<HTMLElement>(`[data-source]`);
      expect(chip).not.toBeNull();
      expect(chip).toHaveAttribute("data-source", source);
    });
  }
});
