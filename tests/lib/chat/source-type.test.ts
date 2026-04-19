import { describe, it, expect } from "vitest";
import {
  classifySourceType,
  type SourceTypeInput,
} from "@/lib/chat/source-type";

const empty: SourceTypeInput = {};

describe("classifySourceType", () => {
  it("returns 'zotero' when zoteroUserId is set", () => {
    expect(classifySourceType({ ...empty, zoteroUserId: "uid" })).toBe(
      "zotero",
    );
  });

  it("returns 'history' when searchFilters is set", () => {
    expect(
      classifySourceType({ ...empty, searchFilters: { q: "anything" } }),
    ).toBe("history");
  });

  it("returns 'upload' when pdfUrl starts with 'storage:'", () => {
    expect(
      classifySourceType({ ...empty, pdfUrl: "storage:abc123" }),
    ).toBe("upload");
  });

  it("returns 'openalex' when openalexId is set and nothing else discriminates", () => {
    expect(
      classifySourceType({ ...empty, openalexId: "W1234567890" }),
    ).toBe("openalex");
  });
});
