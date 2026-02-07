import { describe, expect, it } from "vitest";
import {
  buildChunkedEvidenceUnitsFromPdfPages,
  reciprocalRankFuse,
  scoreLexicalEvidence,
  tokenizeForLexical,
} from "../convex/extraction/evidence_units";

describe("buildChunkedEvidenceUnitsFromPdfPages", () => {
  it("emits non-zero char ranges within page bounds", () => {
    const pages = [
      {
        pageNumber: 2,
        section: "methods",
        text:
          "The review identified approximately 650 studies relating to climate change and migration. " +
          "Of these, over 270 were coded and analyzed using the framework. " +
          "Additional methodological details and inclusion criteria are discussed in this section.",
      },
    ];

    const units = buildChunkedEvidenceUnitsFromPdfPages(pages, {
      targetChars: 120,
      maxChars: 180,
      overlapChars: 20,
      source: "pdfjs_chunks",
    });

    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      expect(unit.page).toBe(2);
      expect(unit.charRange[0]).toBeGreaterThanOrEqual(0);
      expect(unit.charRange[1]).toBeGreaterThan(unit.charRange[0]);
      expect(unit.charRange[1]).toBeLessThanOrEqual(pages[0].text.length);
      expect(unit.source).toBe("pdfjs_chunks");
    }
  });
});

describe("lexical retrieval scoring", () => {
  it("ranks sample-size evidence in top 20 for factual prompts", () => {
    const evidence = [
      {
        evidenceId: "ev_relevant",
        tokens: tokenizeForLexical(
          "The assessment identified approximately 650 studies, of which over 270 were coded and analyzed."
        ),
      },
      ...Array.from({ length: 40 }).map((_, index) => ({
        evidenceId: `ev_noise_${index}`,
        tokens: tokenizeForLexical(
          "This section discusses background climate narratives and broad theoretical perspectives."
        ),
      })),
    ];

    const ranked = scoreLexicalEvidence("what is the sample size?", evidence, 80);
    const rank = ranked.findIndex((item) => item.evidenceId === "ev_relevant");

    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThan(20);
  });
});

describe("retrieval fusion", () => {
  it("produces deterministic reciprocal-rank ordering", () => {
    const dense = [
      { evidenceId: "ev_a", score: 0.92 },
      { evidenceId: "ev_b", score: 0.88 },
      { evidenceId: "ev_c", score: 0.8 },
    ];
    const lexical = [
      { evidenceId: "ev_b", score: 1.4 },
      { evidenceId: "ev_c", score: 1.1 },
      { evidenceId: "ev_a", score: 0.9 },
    ];

    const fused = reciprocalRankFuse(dense, lexical, 30);
    expect(fused.length).toBe(3);
    expect(fused[0].evidenceId).toBe("ev_b");
  });
});
