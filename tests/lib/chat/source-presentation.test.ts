import { describe, it, expect } from "vitest";
import { buildRowMetaSegments } from "@/lib/chat/source-presentation";

const cites = (n: number) => (n === 1 ? "1 cite" : `${n} cites`);

describe("buildRowMetaSegments", () => {
  it("emits venue, type, and pluralised citation count in stable order", () => {
    const out = buildRowMetaSegments(
      { venueName: "Nature", workType: "review", citedByCount: 137 },
      cites,
    );
    expect(out).toEqual(["Nature", "review", "137 cites"]);
  });

  it("drops empty / null / undefined fields silently", () => {
    expect(
      buildRowMetaSegments(
        { venueName: null, workType: undefined, citedByCount: null },
        cites,
      ),
    ).toEqual([]);
  });

  // 0 is meaningful for citation count (never-cited paper) — must
  // survive into the rendered strip, not be coerced to "unknown".
  it("preserves citedByCount=0 as real signal", () => {
    const out = buildRowMetaSegments({ citedByCount: 0 }, cites);
    expect(out).toEqual(["0 cites"]);
  });

  it("uses singular form via the citesLabel callback when count is 1", () => {
    const out = buildRowMetaSegments({ citedByCount: 1 }, cites);
    expect(out).toEqual(["1 cite"]);
  });

  it("trims whitespace and rejects whitespace-only venue / type", () => {
    const out = buildRowMetaSegments(
      { venueName: "  Cell  ", workType: "   ", citedByCount: undefined },
      cites,
    );
    expect(out).toEqual(["Cell"]);
  });

  it("returns the segments alone — caller is responsible for joining with the visual separator", () => {
    const out = buildRowMetaSegments(
      { venueName: "Science", workType: "article", citedByCount: 42 },
      cites,
    );
    expect(out.join(" · ")).toBe("Science · article · 42 cites");
  });
});
