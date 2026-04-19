import { describe, it, expect } from "vitest";
import {
  resolvePaperReference,
  type ResolvablePaper,
} from "@/lib/chat/resolve-paper";

const mkPaper = (title: string): ResolvablePaper => ({
  title,
  authors: ["Doe"],
  year: 2024,
});

describe("resolvePaperReference", () => {
  it("returns an empty array when no [Pn] tokens are present", () => {
    const papers = [mkPaper("A"), mkPaper("B")];
    expect(resolvePaperReference("Plain text with no citation.", papers)).toEqual(
      [],
    );
  });

  it("returns an empty array for empty text", () => {
    expect(resolvePaperReference("", [mkPaper("A")])).toEqual([]);
  });

  it("resolves [P3] to the third paper in a 4-paper corpus", () => {
    const papers = [mkPaper("A"), mkPaper("B"), mkPaper("C"), mkPaper("D")];
    const text = "See [P3] for details.";
    const matches = resolvePaperReference(text, papers);

    expect(matches).toHaveLength(1);
    expect(matches[0].index).toBe(3);
    expect(matches[0].paper).toBe(papers[2]);
    // Offsets should span "[P3]" exactly.
    expect(text.slice(matches[0].start, matches[0].end)).toBe("[P3]");
  });

  it("returns paper=null when the index is out of range", () => {
    const papers = [mkPaper("A")];
    const matches = resolvePaperReference("Ref [P99] unknown.", papers);

    expect(matches).toHaveLength(1);
    expect(matches[0].index).toBe(99);
    expect(matches[0].paper).toBeNull();
  });

  it("finds every match in a multi-citation sentence", () => {
    const papers = [mkPaper("A"), mkPaper("B"), mkPaper("C")];
    const matches = resolvePaperReference(
      "Compare [P1] and [P2], then contrast with [P3].",
      papers,
    );
    expect(matches.map((m) => m.index)).toEqual([1, 2, 3]);
    expect(matches.every((m) => m.paper !== null)).toBe(true);
  });

  it("does not return overlapping or stateful-regex leftovers across calls", () => {
    const papers = [mkPaper("A"), mkPaper("B")];
    const first = resolvePaperReference("[P1]", papers);
    const second = resolvePaperReference("[P2]", papers);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].index).toBe(1);
    expect(second[0].index).toBe(2);
  });
});
