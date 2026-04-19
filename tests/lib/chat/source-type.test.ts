import { describe, it, expect, expectTypeOf } from "vitest";
import {
  classifySourceType,
  type ChatSourceType,
  type SourceTypeInput,
} from "@/lib/chat/source-type";

const empty: SourceTypeInput = {};

describe("classifySourceType", () => {
  it("returns 'zotero' when zoteroUserId is set", () => {
    expect(classifySourceType({ ...empty, zoteroUserId: "uid" })).toBe(
      "zotero",
    );
  });

  it("returns 'openalex' when openalexId is set and nothing else discriminates", () => {
    expect(
      classifySourceType({ ...empty, openalexId: "W1234567890" }),
    ).toBe("openalex");
  });

  it("returns 'unknown' when no discriminator field is set", () => {
    expect(classifySourceType(empty)).toBe("unknown");
  });

  it("applies precedence: zotero > openalex", () => {
    expect(
      classifySourceType({
        zoteroUserId: "uid",
        openalexId: "W1",
      }),
    ).toBe("zotero");
    expect(classifySourceType({ openalexId: "W1" })).toBe("openalex");
  });

  it("narrows its return type to the literal union (not string)", () => {
    expectTypeOf(classifySourceType({})).toEqualTypeOf<ChatSourceType>();
    expectTypeOf<ChatSourceType>().toEqualTypeOf<
      "openalex" | "zotero" | "unknown"
    >();
  });
});
