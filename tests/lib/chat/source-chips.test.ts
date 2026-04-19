import { describe, it, expect } from "vitest";
import {
  computeChipCounts,
  filterBySourceChip,
  type ChippableSource,
} from "@/lib/chat/source-chips";

const row = (sourceType: ChippableSource["sourceType"]): ChippableSource => ({
  sourceType,
});

describe("computeChipCounts", () => {
  it("R1: empty input returns zeros for every chip bucket including unknown", () => {
    expect(computeChipCounts([])).toEqual({
      all: 0,
      openalex: 0,
      upload: 0,
      zotero: 0,
      history: 0,
      unknown: 0,
    });
  });

  it("R2: mixed rows produce per-bucket counts and an aggregate 'all'", () => {
    const rows = [
      row("openalex"),
      row("openalex"),
      row("upload"),
      row("zotero"),
      row("history"),
      row("history"),
      row("history"),
      row("unknown"),
    ];
    expect(computeChipCounts(rows)).toEqual({
      all: 8,
      openalex: 2,
      upload: 1,
      zotero: 1,
      history: 3,
      unknown: 1,
    });
  });
});

describe("filterBySourceChip", () => {
  it("R3: 'all' returns the same array reference (no copy)", () => {
    const rows = [row("openalex"), row("zotero")];
    expect(filterBySourceChip(rows, "all")).toBe(rows);
  });

  it("R4: a specific bucket returns only rows of that sourceType", () => {
    const rows = [row("openalex"), row("zotero"), row("openalex"), row("upload")];
    const filtered = filterBySourceChip(rows, "openalex");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => r.sourceType === "openalex")).toBe(true);
  });

  it("R5: filtering on a bucket with zero matching rows returns []", () => {
    const rows = [row("openalex"), row("zotero")];
    expect(filterBySourceChip(rows, "history")).toEqual([]);
  });
});
