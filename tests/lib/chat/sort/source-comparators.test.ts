import { describe, it, expect } from "vitest";
import {
  sortByComparator,
  type SortableSource,
} from "@/lib/chat/sort/source-comparators";

const row = (overrides: Partial<SortableSource> & { position: number }): SortableSource => ({
  position: overrides.position,
  included: overrides.included ?? true,
  title: overrides.title ?? "z",
  year: "year" in overrides ? overrides.year as number | null : 2024,
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

  it("R4: 'year' desc orders newest first and pushes nulls last", () => {
    const rows = [
      row({ position: 1, year: 1999 }),
      row({ position: 2, year: 2024 }),
      row({ position: 3, year: null }),
      row({ position: 4, year: 2010 }),
    ];
    const sorted = sortByComparator(rows, "year", "desc");
    expect(sorted.map((r) => r.year)).toEqual([2024, 2010, 1999, null]);
  });

  it("R5: 'source' asc orders openalex < upload < zotero < history with position tiebreak", () => {
    const rows = [
      row({ position: 1, sourceType: "history" }),
      row({ position: 2, sourceType: "openalex" }),
      row({ position: 3, sourceType: "upload" }),
      row({ position: 4, sourceType: "openalex" }),
      row({ position: 5, sourceType: "zotero" }),
    ];
    const sorted = sortByComparator(rows, "source", "asc");
    expect(sorted.map((r) => r.position)).toEqual([2, 4, 3, 5, 1]);
  });

  it("R6: 'inContext' desc puts included rows first and excluded last (tiebreak by position)", () => {
    const rows = [
      row({ position: 1, included: false }),
      row({ position: 2, included: true }),
      row({ position: 3, included: false }),
      row({ position: 4, included: true }),
    ];
    const sorted = sortByComparator(rows, "inContext", "desc");
    expect(sorted.map((r) => r.position)).toEqual([2, 4, 1, 3]);
  });

  it("R7: sortByComparator does not mutate the input array", () => {
    const rows = [
      row({ position: 3, title: "z" }),
      row({ position: 1, title: "a" }),
      row({ position: 2, title: "m" }),
    ];
    const snapshot = rows.map((r) => r.position);
    sortByComparator(rows, "title", "asc");
    expect(rows.map((r) => r.position)).toEqual(snapshot);
  });

  it("R8: equal-primary rows fall back on ascending position regardless of dir", () => {
    const rows = [
      row({ position: 5, year: 2024 }),
      row({ position: 1, year: 2024 }),
      row({ position: 9, year: 2010 }),
      row({ position: 3, year: 2010 }),
    ];
    const ascSorted = sortByComparator(rows, "year", "asc");
    expect(ascSorted.map((r) => r.position)).toEqual([3, 9, 1, 5]);
    const descSorted = sortByComparator(rows, "year", "desc");
    expect(descSorted.map((r) => r.position)).toEqual([1, 5, 3, 9]);
  });
});
