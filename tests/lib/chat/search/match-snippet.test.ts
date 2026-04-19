import { describe, it, expect } from "vitest";
import { extractMatchSnippet } from "@/lib/chat/search/match-snippet";

describe("extractMatchSnippet", () => {
  it("R1: empty query returns null", () => {
    expect(extractMatchSnippet("any source text", "")).toBeNull();
    expect(extractMatchSnippet("any source text", "   ")).toBeNull();
  });
});
