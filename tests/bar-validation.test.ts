import { describe, it, expect } from "vitest";
import { validateBarData } from "../lib/extraction/bar-validation";
import type { SafeBarData } from "../lib/extraction/bar-validation";

describe("validateBarData", () => {
  it("returns isEmpty=true for null input", () => {
    const result = validateBarData(null as any);
    expect(result.isEmpty).toBe(true);
    expect(result.max).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("returns isEmpty=true for empty array", () => {
    const result = validateBarData([]);
    expect(result.isEmpty).toBe(true);
  });

  it("returns isEmpty=true when all counts are zero", () => {
    const result = validateBarData([
      { answer: "A", count: 0 },
      { answer: "B", count: 0 },
    ]);
    expect(result.isEmpty).toBe(true);
  });

  it("filters NaN/negative counts; isEmpty=true if nothing left", () => {
    const result = validateBarData([
      { answer: "A", count: NaN },
      { answer: "B", count: -5 },
    ]);
    expect(result.isEmpty).toBe(true);
  });

  it("returns valid items with percentage for normal input", () => {
    const result = validateBarData([
      { answer: "A", count: 90 },
      { answer: "B", count: 10 },
    ]);
    expect(result.isEmpty).toBe(false);
    expect(result.max).toBe(90);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].percentage).toBe(90);
    expect(result.items[1].percentage).toBe(10);
  });

  it("single valid item has isEmpty=false and percentage=100", () => {
    const result = validateBarData([{ answer: "A", count: 42 }]);
    expect(result.isEmpty).toBe(false);
    expect(result.max).toBe(42);
    expect(result.items[0].percentage).toBe(100);
  });
});
