import { describe, expect, it } from "vitest";
import {
  resolvePaperReferences,
  type ResolvablePaper,
} from "@/lib/chat/resolve-paper";

const mkPaper = (title: string): ResolvablePaper => ({
  title,
  authors: ["Doe"],
  year: 2024,
});

describe("resolvePaperReferences", () => {
  it("returns empty for text without any citation tokens", () => {
    const papers = [mkPaper("A"), mkPaper("B")];
    expect(
      resolvePaperReferences("Plain text with no citation.", papers),
    ).toEqual([]);
  });

  it("returns empty for an empty input string", () => {
    expect(resolvePaperReferences("", [mkPaper("A")])).toEqual([]);
  });

  it("resolves a canonical singleton [P3] to the third paper", () => {
    const papers = [mkPaper("A"), mkPaper("B"), mkPaper("C"), mkPaper("D")];
    const text = "See [P3] for details.";
    const groups = resolvePaperReferences(text, papers);

    expect(groups).toHaveLength(1);
    expect(groups[0].citations).toHaveLength(1);
    expect(groups[0].citations[0].index).toBe(3);
    expect(groups[0].citations[0].paper).toBe(papers[2]);
    expect(text.slice(groups[0].start, groups[0].end)).toBe("[P3]");
  });

  it("marks an out-of-range index as unresolved", () => {
    const papers = [mkPaper("A")];
    const groups = resolvePaperReferences("Ref [P99] unknown.", papers);

    expect(groups).toHaveLength(1);
    expect(groups[0].citations[0].index).toBe(99);
    expect(groups[0].citations[0].paper).toBeNull();
  });

  it("finds every singleton match in a multi-citation sentence", () => {
    const papers = [mkPaper("A"), mkPaper("B"), mkPaper("C")];
    const groups = resolvePaperReferences(
      "Compare [P1] and [P2], then contrast with [P3].",
      papers,
    );
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.citations[0].index)).toEqual([1, 2, 3]);
    expect(
      groups.every((g) => g.citations[0].paper !== null),
    ).toBe(true);
  });

  it("expands combined-bracket form [P1, P2, P3] into one group with three citations", () => {
    const papers = [mkPaper("A"), mkPaper("B"), mkPaper("C"), mkPaper("D")];
    const text = "Multiple sources agree [P1, P2, P3] on this point.";
    const groups = resolvePaperReferences(text, papers);

    expect(groups).toHaveLength(1);
    expect(groups[0].citations).toHaveLength(3);
    expect(groups[0].citations.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(groups[0].citations.map((c) => c.paper)).toEqual([
      papers[0],
      papers[1],
      papers[2],
    ]);
    expect(text.slice(groups[0].start, groups[0].end)).toBe("[P1, P2, P3]");
  });

  it("handles combined form with tight or loose spacing", () => {
    const papers = [mkPaper("A"), mkPaper("B"), mkPaper("C")];
    const tight = resolvePaperReferences("[P1,P2]", papers);
    const loose = resolvePaperReferences("[P1,  P2,   P3]", papers);

    expect(tight).toHaveLength(1);
    expect(tight[0].citations.map((c) => c.index)).toEqual([1, 2]);

    expect(loose).toHaveLength(1);
    expect(loose[0].citations.map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it("resolves large combined groups (Gemini observed up to 10)", () => {
    const papers = Array.from({ length: 12 }, (_, i) => mkPaper(`P${i + 1}`));
    const text =
      "Widely supported [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10] finding.";
    const groups = resolvePaperReferences(text, papers);
    expect(groups).toHaveLength(1);
    expect(groups[0].citations).toHaveLength(10);
    expect(groups[0].citations.map((c) => c.index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("accepts lowercase [p1] as a drift variant", () => {
    const papers = [mkPaper("A")];
    const groups = resolvePaperReferences("See [p1] for context.", papers);
    expect(groups).toHaveLength(1);
    expect(groups[0].citations[0].index).toBe(1);
    expect(groups[0].citations[0].paper).toBe(papers[0]);
  });

  it("mixes singleton and combined groups in one text", () => {
    const papers = [mkPaper("A"), mkPaper("B"), mkPaper("C"), mkPaper("D")];
    const text =
      "Early work [P1] established this, but [P2, P3] pushed further and [P4] summarised.";
    const groups = resolvePaperReferences(text, papers);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.citations.map((c) => c.index))).toEqual([
      [1],
      [2, 3],
      [4],
    ]);
  });

  it("reports byte spans that splice cleanly around bracket text", () => {
    const papers = [mkPaper("A"), mkPaper("B")];
    const text = "prefix [P1, P2] suffix";
    const [group] = resolvePaperReferences(text, papers);
    const before = text.slice(0, group.start);
    const after = text.slice(group.end);
    expect(before).toBe("prefix ");
    expect(after).toBe(" suffix");
    expect(group.raw).toBe("[P1, P2]");
  });

  it("ignores malformed brackets (no P prefix)", () => {
    const papers = [mkPaper("A")];
    expect(resolvePaperReferences("See [1] for details.", papers)).toEqual([]);
  });

  it("ignores bare Pn outside of brackets", () => {
    const papers = [mkPaper("A")];
    expect(resolvePaperReferences("See P1 for details.", papers)).toEqual([]);
  });

  it("does not leak regex state across calls", () => {
    const papers = [mkPaper("A"), mkPaper("B")];
    const first = resolvePaperReferences("[P1]", papers);
    const second = resolvePaperReferences("[P2]", papers);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].citations[0].index).toBe(1);
    expect(second[0].citations[0].index).toBe(2);
  });

  it("partially resolves a combined group when one index is out of range", () => {
    const papers = [mkPaper("A"), mkPaper("B")];
    const [group] = resolvePaperReferences("[P1, P5, P2]", papers);
    expect(group.citations).toHaveLength(3);
    expect(group.citations[0].paper).toBe(papers[0]);
    expect(group.citations[1].paper).toBeNull();
    expect(group.citations[2].paper).toBe(papers[1]);
  });
});
