import { describe, it, expect } from "vitest";
import { sanitizeSelection } from "./sanitize";

describe("sanitizeSelection", () => {
  it("returns an empty array for undefined", () => {
    expect(sanitizeSelection(undefined)).toEqual([]);
  });

  it("returns an empty array for an empty array", () => {
    expect(sanitizeSelection([])).toEqual([]);
  });

  it("trims surrounding whitespace from each value", () => {
    expect(sanitizeSelection(["  us  ", "uk "])).toEqual(["us", "uk"]);
  });

  it("drops empty and whitespace-only values", () => {
    expect(sanitizeSelection(["us", "", "   ", "uk"])).toEqual(["us", "uk"]);
  });

  it("collapses an all-empty selection to []", () => {
    expect(sanitizeSelection(["", "  ", "\t"])).toEqual([]);
  });

  it("preserves order and does not dedup (sanitize only)", () => {
    expect(sanitizeSelection(["uk", "us", "uk"])).toEqual(["uk", "us", "uk"]);
  });
});
