import { describe, it, expect } from "vitest";
import { normalizeToMax, scaleAnswersForDisplay } from "../lib/extraction/bar-scaling";

describe("normalizeToMax", () => {
  it("maps dominant value to 1.0 and scales others proportionally", () => {
    const result = normalizeToMax([85, 10, 5]);
    expect(result[0]).toBe(1.0);
    expect(result[1]).toBeCloseTo(10 / 85);
    expect(result[2]).toBeCloseTo(5 / 85);
  });

  it("returns all-zeros for all-zero input without NaN", () => {
    const result = normalizeToMax([0, 0, 0]);
    expect(result).toEqual([0, 0, 0]);
    result.forEach(v => expect(Number.isNaN(v)).toBe(false));
  });

  it("returns [1.0] for single-item input", () => {
    expect(normalizeToMax([42])).toEqual([1.0]);
  });

  it("treats NaN as 0 and never outputs NaN", () => {
    const result = normalizeToMax([NaN, 5]);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(1.0);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeToMax([])).toEqual([]);
  });
});

describe("scaleAnswersForDisplay", () => {
  it("dominant answer gets scaledWidth=1.0, minority answer proportional", () => {
    const result = scaleAnswersForDisplay([
      { answer: "Yes", count: 80 },
      { answer: "No", count: 20 },
    ]);
    expect(result[0].scaledWidth).toBe(1.0);
    expect(result[0].percentage).toBe(80);
    expect(result[1].scaledWidth).toBe(0.25);
    expect(result[1].percentage).toBe(20);
  });

  it("all-zero counts produce all scaledWidth=0 without NaN", () => {
    const result = scaleAnswersForDisplay([
      { answer: "Yes", count: 0 },
      { answer: "No", count: 0 },
    ]);
    result.forEach(r => {
      expect(r.scaledWidth).toBe(0);
      expect(Number.isNaN(r.percentage)).toBe(false);
    });
  });

  it("single answer gets scaledWidth=1.0, percentage=100", () => {
    const result = scaleAnswersForDisplay([{ answer: "Yes", count: 50 }]);
    expect(result[0].scaledWidth).toBe(1.0);
    expect(result[0].percentage).toBe(100);
  });
});
