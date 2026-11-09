import { describe, expect, it } from "vitest";
import { matchRemotePattern } from "next/dist/shared/lib/match-remote-pattern";
import { COMMUNITY_FILE_PATTERNS, COVER_KINDS, coverOf, resizable } from "./cover";

describe("a paper's placeholder cover", () => {
  it("is always the same for one paper, and papers don't all wear the same", () => {
    expect(coverOf("OS234347060")).toEqual(coverOf("OS234347060"));
    const looks = new Set(Array.from({ length: 60 }, (_, index) => JSON.stringify(coverOf(`OS${200000000 + index}`))));
    const kinds = new Set(Array.from({ length: 60 }, (_, index) => coverOf(`OS${200000000 + index}`).kind));
    expect(kinds.size).toBe(COVER_KINDS.length);
    expect(looks.size).toBeGreaterThan(10);
  });
});

describe("a community cover the server resizes", () => {
  // next/image refuses any other address (a 400, or a thrown error in development), so those stay plain pictures.
  it("is exactly one next.config.ts lets next/image fetch", () => {
    const allowed = (src: string) => COMMUNITY_FILE_PATTERNS.some((pattern) => matchRemotePattern(pattern, new URL(src)));
    const files = COMMUNITY_FILE_PATTERNS[0]!.href.replace("**", "");
    for (const src of [`${files}el-public-1/sources/W1:pdf/abc.jpg`, `${files}el-public-1/a.jpg?v=2`, `${files}a.jpg#top`, "https://evil.supabase.co/storage/v1/object/public/a.jpg", "https://example.org/cover.jpg", `${files.replace("https", "http")}a.jpg`]) {
      expect(resizable(src), src).toBe(allowed(src));
    }
    expect(resizable(`${files}el-public-1/sources/W1:pdf/abc.jpg`)).toBe(true);
  });
});
