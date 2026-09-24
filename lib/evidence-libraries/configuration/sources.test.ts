import { describe, expect, it } from "vitest";
import { assertImmutableOpenAlexQueryVersions } from "./sources";

const source = (
  version: string,
  query: { filter?: string; search?: string },
) => ({
  key: "openalex-education",
  provider: "openalex",
  enabled: true,
  writebackEnabled: false,
  settings: {
    approvedQuery: {
      version,
      approvedAt: "2026-09-24T12:00:00.000Z",
      query,
    },
    downloadPdfs: false,
  },
});

describe("OpenAlex approved query versions", () => {
  it("allows a new immutable version for a changed query", () => {
    expect(() =>
      assertImmutableOpenAlexQueryVersions(
        [[source("v1", { search: "education" })]],
        [source("v2", { search: "education policy" })],
      ),
    ).not.toThrow();
  });

  it("rejects reusing an earlier version with changed contents", () => {
    expect(() =>
      assertImmutableOpenAlexQueryVersions(
        [[source("v1", { search: "education" })]],
        [source("v1", { search: "education policy" })],
      ),
    ).toThrow("cannot be changed");
  });

  it("treats equivalent query key order as the same approved version", () => {
    expect(() =>
      assertImmutableOpenAlexQueryVersions(
        [[source("v1", { filter: "type:article", search: "education" })]],
        [source("v1", { search: "education", filter: "type:article" })],
      ),
    ).not.toThrow();
  });
});
