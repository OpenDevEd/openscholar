import { describe, it, expect } from "vitest";
import {
  sortByComparator,
  type SortableSource,
} from "@/lib/chat/sort/source-comparators";

const row = (overrides: Partial<SortableSource> & { position: number }): SortableSource => ({
  position: overrides.position,
  included: overrides.included ?? true,
  title: overrides.title ?? "z",
  year: overrides.year ?? 2024,
  sourceType: overrides.sourceType ?? "openalex",
});

describe("sortByComparator", () => {
  it("R1: 'added' asc preserves position order", () => {
    const rows = [row({ position: 3 }), row({ position: 1 }), row({ position: 2 })];
    const sorted = sortByComparator(rows, "added", "asc");
    expect(sorted.map((r) => r.position)).toEqual([1, 2, 3]);
  });

  it("R2: 'added' desc reverses position order", () => {
    const rows = [row({ position: 3 }), row({ position: 1 }), row({ position: 2 })];
    const sorted = sortByComparator(rows, "added", "desc");
    expect(sorted.map((r) => r.position)).toEqual([3, 2, 1]);
  });

  it("R3: 'title' asc orders alphabetically via localeCompare", () => {
    const rows = [
      row({ position: 1, title: "Banana" }),
      row({ position: 2, title: "apple" }),
      row({ position: 3, title: "Cherry" }),
    ];
    const sorted = sortByComparator(rows, "title", "asc");
    expect(sorted.map((r) => r.title)).toEqual(["apple", "Banana", "Cherry"]);
  });
});
