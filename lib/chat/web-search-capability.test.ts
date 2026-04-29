import { describe, expect, it } from "vitest";
import { modelSupportsWebSearch } from "./web-search-capability";

describe("modelSupportsWebSearch", () => {
  it("returns false when supportedParameters is missing", () => {
    expect(modelSupportsWebSearch({})).toBe(false);
  });

  it("returns false when supportedParameters is empty", () => {
    expect(modelSupportsWebSearch({ supportedParameters: [] })).toBe(false);
  });

  it("returns true when supportedParameters contains 'tools'", () => {
    expect(modelSupportsWebSearch({ supportedParameters: ["tools"] })).toBe(
      true,
    );
  });

  it("returns true when 'tools' coexists with other capability tokens", () => {
    expect(
      modelSupportsWebSearch({
        supportedParameters: ["tools", "tool_choice", "web_search_options"],
      }),
    ).toBe(true);
  });

  it("returns false for the Perplexity Sonar shape (web_search_options without tools)", () => {
    expect(
      modelSupportsWebSearch({ supportedParameters: ["web_search_options"] }),
    ).toBe(false);
  });

  it("returns false for a null model", () => {
    expect(modelSupportsWebSearch(null)).toBe(false);
  });

  it("returns false for an undefined model", () => {
    expect(modelSupportsWebSearch(undefined)).toBe(false);
  });

  it("returns false when supportedParameters is null", () => {
    expect(modelSupportsWebSearch({ supportedParameters: null })).toBe(false);
  });
});
