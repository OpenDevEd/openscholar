import { describe, expect, it } from "vitest";
import { buildChatSourceFingerprint } from "@/lib/chat/source-request";

describe("buildChatSourceFingerprint", () => {
  it("changes when the OpenAlex query changes", () => {
    expect(
      buildChatSourceFingerprint({
        searchFilters: { query: "machine learning", sortBy: "relevance" },
        limit: 25,
      }),
    ).not.toBe(
      buildChatSourceFingerprint({
        searchFilters: { query: "causal inference", sortBy: "relevance" },
        limit: 25,
      }),
    );
  });

  it("changes when the pulled source count changes", () => {
    expect(
      buildChatSourceFingerprint({
        searchFilters: { query: "machine learning", sortBy: "relevance" },
        limit: 25,
      }),
    ).not.toBe(
      buildChatSourceFingerprint({
        searchFilters: { query: "machine learning", sortBy: "relevance" },
        limit: 50,
      }),
    );
  });

  it("canonicalizes order-insensitive filters through the OpenAlex hash", () => {
    expect(
      buildChatSourceFingerprint({
        searchFilters: {
          query: "policy",
          selectedRegions: ["asia", "europe"],
        },
        limit: 20,
      }),
    ).toBe(
      buildChatSourceFingerprint({
        searchFilters: {
          query: "policy",
          selectedRegions: ["europe", "asia"],
        },
        limit: 20,
      }),
    );
  });
});
