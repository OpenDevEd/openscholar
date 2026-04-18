/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceChip } from "@/components/extraction/bucket/source-chip";
import { SOURCE_COLOR_VAR } from "@/lib/bucket/source-labels";
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

    test(`${source} dot backgroundColor uses var(${SOURCE_COLOR_VAR[source]})`, () => {
      const { container } = render(<SourceChip source={source} />);
      const dot = container.querySelector(
        'span[aria-hidden="true"]',
      ) as HTMLElement | null;
      expect(dot).not.toBeNull();
      expect(dot!.style.backgroundColor).toBe(
        `var(${SOURCE_COLOR_VAR[source]})`,
      );
    });
  }
});
