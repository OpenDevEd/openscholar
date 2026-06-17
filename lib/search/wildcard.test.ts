import { describe, it, expect } from "vitest";
import { hasUnquotedWildcard } from "./wildcard";

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
