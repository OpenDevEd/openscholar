import { describe, it, expect } from "vitest";
import { SearchError, classifySearchError } from "./search-error";

describe("SearchError", () => {
  it("carries the http status as a structured field that survives serialization", () => {
    const err = new SearchError("Wildcards require the exact field", 400);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SearchError");
    expect(err.status).toBe(400);
    expect(err.message).toBe("Wildcards require the exact field");
  });
});

describe("classifySearchError", () => {
  it("maps a 400 to an invalid-query title and surfaces OpenAlex's real reason as the description", () => {
    const err = new SearchError("A filter value contains an unescaped comma.", 400);
    expect(classifySearchError(err)).toEqual({
      titleKey: "searchInvalidQuery",
      description: "A filter value contains an unescaped comma.",
    });
  });

  it("maps a 429 to the rate-limit copy (i18n keys, no raw description)", () => {
    const err = new SearchError("Too many requests", 429);
    expect(classifySearchError(err)).toEqual({
      titleKey: "tooManyRequests",
      descriptionKey: "tooManyRequestsDescription",
    });
  });

  it("falls back to a generic failure for other statuses, keeping the message", () => {
    const err = new SearchError("Error 500", 500);
    expect(classifySearchError(err)).toEqual({
      titleKey: "searchFailed",
      description: "Error 500",
    });
  });

  it("treats a non-SearchError as a generic failure", () => {
    expect(classifySearchError(new Error("boom"))).toEqual({
      titleKey: "searchFailed",
      description: "boom",
    });
  });
});
