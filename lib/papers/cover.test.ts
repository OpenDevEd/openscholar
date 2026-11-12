import { describe, expect, it } from "vitest";
import { matchRemotePattern } from "next/dist/shared/lib/match-remote-pattern";
import { COMMUNITY_FILE_PATTERNS, COVER_KINDS, coverFit, coverOf, resizable } from "./cover";

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

describe("the picture of a first page in a cover's frame", () => {
  it("fills the frame when it is shaped like a page, and keeps its own shape when it isn't", () => {
    // A4, US Letter and the frame's own 3 by 4.
    for (const page of [210 / 297, 8.5 / 11, 3 / 4]) expect(coverFit(page), String(page)).toBe("fill");
    // A slide, a square and a landscape page are shown whole across the frame's width.
    for (const wide of [16 / 9, 1, 297 / 210]) expect(coverFit(wide), String(wide)).toBe("wide");
    // A poster or a long infographic is shown whole down the frame's height.
    expect(coverFit(1 / 3)).toBe("tall");
  });
  it("keeps the whole frame for a picture whose shape isn't known", () => {
    for (const unknown of [null, 0, Number.NaN, Number.POSITIVE_INFINITY]) expect(coverFit(unknown)).toBe("fill");
  });
});
