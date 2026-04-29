import { describe, expect, it } from "vitest";
import { parseResponse, toSnakeCaseBody } from "./client";

describe("toSnakeCaseBody", () => {
  it("snake-cases the documented camelCase fields", () => {
    expect(
      toSnakeCaseBody({
        query: "carbon capture",
        searchDepth: "basic",
        maxResults: 3,
        includeDomains: ["arxiv.org"],
      }),
    ).toEqual({
      query: "carbon capture",
      search_depth: "basic",
      max_results: 3,
      include_domains: ["arxiv.org"],
    });
  });

  it("maps every supported field name to its snake_case form", () => {
    const body = toSnakeCaseBody({
      query: "q",
      searchDepth: "advanced",
      maxResults: 7,
      topic: "general",
      includeAnswer: false,
      includeRawContent: false,
      includeDomains: ["nature.com"],
      excludeDomains: ["spam.example"],
      timeRange: "month",
      country: "us",
      chunksPerSource: 2,
      includeUsage: true,
    });
    expect(body).toEqual({
      query: "q",
      search_depth: "advanced",
      max_results: 7,
      topic: "general",
      include_answer: false,
      include_raw_content: false,
      include_domains: ["nature.com"],
      exclude_domains: ["spam.example"],
      time_range: "month",
      country: "us",
      chunks_per_source: 2,
      include_usage: true,
    });
  });

  it("omits undefined optional fields entirely", () => {
    const body = toSnakeCaseBody({ query: "q" });
    expect(body).toEqual({ query: "q" });
    expect(body).not.toHaveProperty("search_depth");
    expect(body).not.toHaveProperty("max_results");
    expect(body).not.toHaveProperty("include_domains");
  });
});

describe("parseResponse", () => {
  it("returns a typed response with camelCase fields and mapped result keys", () => {
    const parsed = parseResponse({
      query: "carbon capture",
      answer: "Carbon capture is …",
      results: [
        {
          title: "Direct air capture",
          url: "https://arxiv.org/abs/2401.00001",
          content: "Snippet here",
          score: 0.92,
          raw_content: "Full raw markdown",
          published_date: "2024-01-01",
        },
        {
          title: "Mineralization pathways",
          url: "https://nature.com/articles/example",
          content: "Snippet two",
          score: 0.81,
        },
      ],
      response_time: 1.23,
      request_id: "req_abc123",
      usage: { credits: 1 },
    });
    expect(parsed).toEqual({
      query: "carbon capture",
      answer: "Carbon capture is …",
      results: [
        {
          title: "Direct air capture",
          url: "https://arxiv.org/abs/2401.00001",
          content: "Snippet here",
          score: 0.92,
          rawContent: "Full raw markdown",
          publishedDate: "2024-01-01",
        },
        {
          title: "Mineralization pathways",
          url: "https://nature.com/articles/example",
          content: "Snippet two",
          score: 0.81,
        },
      ],
      responseTime: 1.23,
      requestId: "req_abc123",
      usage: { creditsUsed: 1 },
    });
  });

  it("returns no usage when the API omits the usage object", () => {
    const parsed = parseResponse({
      query: "q",
      results: [],
      response_time: 0.4,
      request_id: "req_xyz",
    });
    expect(parsed.usage).toBeUndefined();
  });

  it("throws when results is missing", () => {
    expect(() =>
      parseResponse({
        query: "q",
        response_time: 0.1,
        request_id: "req_no_results",
      }),
    ).toThrow();
  });

  it("throws when a result entry is missing required fields", () => {
    expect(() =>
      parseResponse({
        query: "q",
        results: [{ url: "https://example.com" }],
        response_time: 0.1,
        request_id: "req_partial",
      }),
    ).toThrow();
  });
});
