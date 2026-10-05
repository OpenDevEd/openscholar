import { describe, it, expect } from "vitest";
import { hasUnquotedWildcard, hasWildcardInQuotedPhrase, withoutQuotedQuestionMarks } from "./wildcard";

describe("hasUnquotedWildcard", () => {
  it("detects a trailing * outside quotes", () => {
    expect(hasUnquotedWildcard("transform*")).toBe(true);
  });

  it("detects a mid-token * outside quotes", () => {
    expect(hasUnquotedWildcard("trans*form")).toBe(true);
  });

  it("detects the ? single-char wildcard", () => {
    expect(hasUnquotedWildcard("transform?")).toBe(true);
  });

  it("returns false when there is no wildcard", () => {
    expect(hasUnquotedWildcard("machine learning")).toBe(false);
  });

  it("ignores a wildcard that lives inside a quoted phrase", () => {
    expect(hasUnquotedWildcard('"transform*"')).toBe(false);
  });

  it("returns false when every wildcard is inside quotes", () => {
    expect(hasUnquotedWildcard('"a*b" "c?d"')).toBe(false);
  });

  it("detects an unquoted wildcard sitting next to a quoted phrase", () => {
    expect(
      hasUnquotedWildcard('"software development" AND transform*')
    ).toBe(true);
  });

  it("detects a wildcard inside parentheses (still unquoted)", () => {
    expect(hasUnquotedWildcard("(impact OR transform* OR evolution)")).toBe(true);
  });

  it("treats empty / non-string input as no wildcard", () => {
    expect(hasUnquotedWildcard("")).toBe(false);
    // @ts-expect-error exercising the runtime guard
    expect(hasUnquotedWildcard(null)).toBe(false);
    // @ts-expect-error exercising the runtime guard
    expect(hasUnquotedWildcard(undefined)).toBe(false);
  });
});

describe("hasWildcardInQuotedPhrase", () => {
  it("detects a trailing * inside a quoted phrase (the OpenAlex 400 case)", () => {
    expect(hasWildcardInQuotedPhrase('"contextual support*"')).toBe(true);
  });

  it("detects a ? inside a quoted phrase", () => {
    expect(hasWildcardInQuotedPhrase('"a?b"')).toBe(true);
  });

  it("returns false for a clean quoted phrase", () => {
    expect(hasWildcardInQuotedPhrase('"machine learning"')).toBe(false);
  });

  it("returns false for a bare (unquoted) wildcard term", () => {
    expect(hasWildcardInQuotedPhrase("contextual support*")).toBe(false);
  });

  it("returns false when an unquoted wildcard sits next to a clean phrase", () => {
    expect(hasWildcardInQuotedPhrase('"deep learning" AND algorithm*')).toBe(false);
  });

  it("detects a wildcard in one phrase among several", () => {
    expect(hasWildcardInQuotedPhrase('"machine learning" OR "neural net*"')).toBe(true);
  });

  it("treats empty / non-string input as none", () => {
    expect(hasWildcardInQuotedPhrase("")).toBe(false);
    // @ts-expect-error exercising the runtime guard
    expect(hasWildcardInQuotedPhrase(null)).toBe(false);
  });
});

describe("withoutQuotedQuestionMarks", () => {
  it("takes the mark out of a title quoted with it, which OpenAlex would read as a wildcard and refuse", () => {
    const query = withoutQuotedQuestionMarks('"Food for Thought?" Aurino AND "What works? A review"');
    expect(query).toBe('"Food for Thought" Aurino AND "What works A review"');
    expect(hasWildcardInQuotedPhrase(query)).toBe(false);
  });

  it("leaves a wildcard outside quotes, and a star inside them, as they were typed", () => {
    expect(withoutQuotedQuestionMarks('wom?n "school feeding" educat*')).toBe('wom?n "school feeding" educat*');
    expect(withoutQuotedQuestionMarks('"smart* phone"')).toBe('"smart* phone"');
  });
});
