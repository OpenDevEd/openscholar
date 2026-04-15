import { describe, it, expect } from "vitest";
import { classifyExtractionError } from "./errors";

describe("classifyExtractionError", () => {
  // -----------------------------------------------------------------------
  // Retryable: timeout (DOMException)
  // -----------------------------------------------------------------------

  it("classifies AbortError DOMException as retryable timeout", () => {
    const error = new DOMException("Operation timed out", "AbortError");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: true,
      category: "timeout",
      message: "Operation timed out",
    });
  });

  it("classifies TimeoutError DOMException as retryable timeout", () => {
    const error = new DOMException("Signal timed out", "TimeoutError");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: true,
      category: "timeout",
      message: "Signal timed out",
    });
  });

  // -----------------------------------------------------------------------
  // Retryable: network (TypeError with "fetch")
  // -----------------------------------------------------------------------

  it("classifies TypeError with 'fetch failed' as retryable network", () => {
    const error = new TypeError("fetch failed");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: true,
      category: "network",
      message: "fetch failed",
    });
  });

  // -----------------------------------------------------------------------
  // Retryable: rate_limit (429 or "rate limit")
  // -----------------------------------------------------------------------

  it("classifies Error with '429' as retryable rate_limit", () => {
    const error = new Error("HTTP 429 Too Many Requests");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: true,
      category: "rate_limit",
      message: "HTTP 429 Too Many Requests",
    });
  });

  it("classifies Error with 'rate limit exceeded' as retryable rate_limit", () => {
    const error = new Error("rate limit exceeded, please retry later");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: true,
      category: "rate_limit",
      message: "rate limit exceeded, please retry later",
    });
  });

  // -----------------------------------------------------------------------
  // Retryable: server_error (5xx)
  // -----------------------------------------------------------------------

  it("classifies Error with '500 Internal Server Error' as retryable server_error", () => {
    const error = new Error("HTTP 500 Internal Server Error");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: true,
      category: "server_error",
      message: "HTTP 500 Internal Server Error",
    });
  });

  it("classifies Error with '502 Bad Gateway' as retryable server_error", () => {
    const error = new Error("HTTP 502 Bad Gateway");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: true,
      category: "server_error",
      message: "HTTP 502 Bad Gateway",
    });
  });

  // -----------------------------------------------------------------------
  // Permanent: not_found (404)
  // -----------------------------------------------------------------------

  it("classifies Error with '404 Not Found' as permanent not_found", () => {
    const error = new Error("HTTP 404 Not Found");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: false,
      category: "not_found",
      message: "HTTP 404 Not Found",
    });
  });

  // -----------------------------------------------------------------------
  // Permanent: bad_request (400)
  // -----------------------------------------------------------------------

  it("classifies Error with '400 Bad Request' as permanent bad_request", () => {
    const error = new Error("HTTP 400 Bad Request");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: false,
      category: "bad_request",
      message: "HTTP 400 Bad Request",
    });
  });

  // -----------------------------------------------------------------------
  // Permanent: validation (ZodError or "validation")
  // -----------------------------------------------------------------------

  it("classifies Error with 'ZodError' as permanent validation", () => {
    const error = new Error("ZodError: invalid input at path .answer");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: false,
      category: "validation",
      message: "ZodError: invalid input at path .answer",
    });
  });

  it("classifies Error with 'validation failed' as permanent validation", () => {
    const error = new Error("validation failed for schema extraction_result");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: false,
      category: "validation",
      message: "validation failed for schema extraction_result",
    });
  });

  // -----------------------------------------------------------------------
  // Permanent: empty_body
  // -----------------------------------------------------------------------

  it("classifies Error with 'empty body text' as permanent empty_body", () => {
    const error = new Error("empty body text for paper");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: false,
      category: "empty_body",
      message: "empty body text for paper",
    });
  });

  it("classifies Error with 'no body text' as permanent empty_body", () => {
    const error = new Error("no body text available");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: false,
      category: "empty_body",
      message: "no body text available",
    });
  });

  // -----------------------------------------------------------------------
  // Permanent: page_limit
  // -----------------------------------------------------------------------

  it("classifies Error with 'page count exceeded' as permanent page_limit", () => {
    const error = new Error("page count exceeded maximum of 200");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: false,
      category: "page_limit",
      message: "page count exceeded maximum of 200",
    });
  });

  // -----------------------------------------------------------------------
  // Default fallback: retryable network
  // -----------------------------------------------------------------------

  it("classifies unknown Error as retryable network (default fallback)", () => {
    const error = new Error("something completely unknown");
    const result = classifyExtractionError(error);
    expect(result).toEqual({
      retryable: true,
      category: "network",
      message: "something completely unknown",
    });
  });

  // -----------------------------------------------------------------------
  // Non-Error input: string passed directly
  // -----------------------------------------------------------------------

  it("handles non-Error input (string) with String(error) as message", () => {
    const result = classifyExtractionError("raw string error");
    expect(result.message).toBe("raw string error");
    expect(result.retryable).toBe(true);
    expect(result.category).toBe("network");
  });

  // -----------------------------------------------------------------------
  // Structural: every result has exactly 3 fields
  // -----------------------------------------------------------------------

  it("returns object with exactly 3 keys (retryable, category, message)", () => {
    const testCases = [
      new DOMException("timeout", "AbortError"),
      new TypeError("fetch failed"),
      new Error("HTTP 429"),
      new Error("HTTP 500"),
      new Error("404 Not Found"),
      new Error("400 Bad Request"),
      new Error("ZodError"),
      new Error("empty body"),
      new Error("page limit exceeded"),
      new Error("unknown error"),
      "string error",
    ];

    for (const input of testCases) {
      const result = classifyExtractionError(input);
      expect(Object.keys(result)).toHaveLength(3);
      expect(result).toHaveProperty("retryable");
      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("message");
    }
  });
});
