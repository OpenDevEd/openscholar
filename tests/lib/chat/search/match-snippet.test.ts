import { describe, it, expect } from "vitest";
import { extractMatchSnippet } from "@/lib/chat/search/match-snippet";

describe("extractMatchSnippet", () => {
  it("R1: empty query returns null", () => {
    expect(extractMatchSnippet("any source text", "")).toBeNull();
    expect(extractMatchSnippet("any source text", "   ")).toBeNull();
  });

  it("R2: query not present in the source returns null", () => {
    expect(extractMatchSnippet("hello world", "xyz")).toBeNull();
    expect(extractMatchSnippet("", "anything")).toBeNull();
  });
});
