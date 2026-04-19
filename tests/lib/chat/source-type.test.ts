import { describe, it, expect, expectTypeOf } from "vitest";
import {
  classifySourceType,
  type SourceType,
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

  it("returns 'unknown' when no discriminator field is set", () => {
    expect(classifySourceType(empty)).toBe("unknown");
  });

  it("applies precedence: zotero > history > upload > openalex", () => {
    // zotero beats everything
    expect(
      classifySourceType({
        zoteroUserId: "uid",
        searchFilters: { q: "x" },
        pdfUrl: "storage:abc",
        openalexId: "W1",
      }),
    ).toBe("zotero");

    // history beats upload + openalex
    expect(
      classifySourceType({
        searchFilters: { q: "x" },
        pdfUrl: "storage:abc",
        openalexId: "W1",
      }),
    ).toBe("history");

    // upload beats openalex
    expect(
      classifySourceType({
        pdfUrl: "storage:abc",
        openalexId: "W1",
      }),
    ).toBe("upload");

    // openalex lone winner
    expect(classifySourceType({ openalexId: "W1" })).toBe("openalex");
  });

  it("narrows its return type to the literal union (not string)", () => {
    expectTypeOf(classifySourceType({})).toEqualTypeOf<SourceType>();
    expectTypeOf<SourceType>().toEqualTypeOf<
      "openalex" | "upload" | "zotero" | "history" | "unknown"
    >();
  });
});
