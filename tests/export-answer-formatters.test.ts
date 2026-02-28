import { describe, expect, it } from "vitest";
import {
  formatAnswerForCSV,
  formatAnswerForExcel,
} from "../lib/extraction/export";

describe("formatAnswerForCSV", () => {
  it("returns empty string for null", () => {
    expect(formatAnswerForCSV(null, "string")).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatAnswerForCSV(undefined, "string")).toBe("");
  });

  it('returns "Yes" for boolean true', () => {
    expect(formatAnswerForCSV(true, "boolean")).toBe("Yes");
  });

  it('returns "No" for boolean false', () => {
    expect(formatAnswerForCSV(false, "boolean")).toBe("No");
  });

  it("joins array items with semicolon-space", () => {
    expect(formatAnswerForCSV(["a", "b", "c"], "array")).toBe("a; b; c");
  });

  it("returns empty string for empty array (join result)", () => {
    expect(formatAnswerForCSV([], "array")).toBe("");
  });

  it("stringifies number values", () => {
    expect(formatAnswerForCSV(42, "number")).toBe("42");
  });

  it("returns string values as-is via String()", () => {
    expect(formatAnswerForCSV("hello", "string")).toBe("hello");
  });

  it("stringifies number when type is string", () => {
    expect(formatAnswerForCSV(3.14, "string")).toBe("3.14");
  });
});

describe("formatAnswerForExcel", () => {
  it("returns empty string for null", () => {
    expect(formatAnswerForExcel(null, "string")).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatAnswerForExcel(undefined, "number")).toBe("");
  });

  it('returns "Yes" for boolean true', () => {
    expect(formatAnswerForExcel(true, "boolean")).toBe("Yes");
  });

  it('returns "No" for boolean false', () => {
    expect(formatAnswerForExcel(false, "boolean")).toBe("No");
  });

  it("joins array items with semicolon-space", () => {
    expect(formatAnswerForExcel(["x", "y"], "array")).toBe("x; y");
  });

  it("returns Number for number type (not string) -- key difference from CSV", () => {
    const result = formatAnswerForExcel(42, "number");
    expect(result).toBe(42);
    expect(typeof result).toBe("number");
  });

  it("converts string to Number when type is number", () => {
    const result = formatAnswerForExcel("42", "number");
    expect(result).toBe(42);
    expect(typeof result).toBe("number");
  });

  it("returns string for string type", () => {
    expect(formatAnswerForExcel("hello", "string")).toBe("hello");
  });

  it("returns stringified number when type is not number", () => {
    expect(formatAnswerForExcel(42, "string")).toBe("42");
  });
});
