import { describe, expect, it } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import {
  resolvePaperReferences,
  type ResolvablePaper,
} from "@/lib/chat/resolve-paper";

type Opts = Partial<Pick<ResolvablePaper, "included">>;

let counter = 0;
const mkPaper = (
  title: string,
  position: number,
  opts: Opts = {},
): ResolvablePaper => ({
  sourceId: `src_${counter++}` as Id<"extractionJobSources">,
  chatPaperId: `cp_${counter++}` as Id<"chatPapers">,
  position,
  title,
  authors: ["Doe"],
  year: 2024,
  abstract: null,
  doi: null,
  pdfUrl: null,
  openalexId: null,
  included: opts.included ?? true,
});

describe("resolvePaperReferences", () => {
  it("returns empty for text without any citation tokens", () => {
    const papers = [mkPaper("A", 1), mkPaper("B", 2)];
    expect(
      resolvePaperReferences("Plain text with no citation.", papers),
    ).toEqual([]);
  });

  it("returns empty for an empty input string", () => {
    expect(resolvePaperReferences("", [mkPaper("A", 1)])).toEqual([]);
  });

  it("resolves [P1] by position against a single-paper array", () => {
    const papers = [mkPaper("A", 1)];
    const groups = resolvePaperReferences("See [P1] here.", papers);
    expect(groups).toHaveLength(1);
    expect(groups[0].citations[0].paper).toBe(papers[0]);
  });

  it("resolves [P3] in a gap-containing array: [{pos:1},{pos:3}] → pos-3 paper", () => {
    const p1 = mkPaper("A", 1);
    const p3 = mkPaper("C", 3);
    const groups = resolvePaperReferences("See [P3] here.", [p1, p3]);
    expect(groups).toHaveLength(1);
    expect(groups[0].citations[0].index).toBe(3);
    expect(groups[0].citations[0].paper).toBe(p3);
  });

  it("returns null when citing a position that is absent (gap): [P2] against [{pos:1},{pos:3}]", () => {
    const p1 = mkPaper("A", 1);
    const p3 = mkPaper("C", 3);
    const groups = resolvePaperReferences("See [P2].", [p1, p3]);
    expect(groups).toHaveLength(1);
    expect(groups[0].citations[0].index).toBe(2);
    expect(groups[0].citations[0].paper).toBeNull();
  });

  it("marks an out-of-range position as unresolved", () => {
    const papers = [mkPaper("A", 1)];
    const groups = resolvePaperReferences("Ref [P99] unknown.", papers);

    expect(groups).toHaveLength(1);
    expect(groups[0].citations[0].index).toBe(99);
    expect(groups[0].citations[0].paper).toBeNull();
  });

  it("resolves [P5] when max position is 3 as unresolved", () => {
    const papers = [mkPaper("A", 1), mkPaper("B", 2), mkPaper("C", 3)];
    const [group] = resolvePaperReferences("See [P5].", papers);
    expect(group.citations[0].paper).toBeNull();
  });

  it("expands [P1, P3, P5] as three independent position lookups", () => {
    const p1 = mkPaper("A", 1);
    const p3 = mkPaper("C", 3);
    const p5 = mkPaper("E", 5);
    const groups = resolvePaperReferences("[P1, P3, P5]", [p1, p3, p5]);
    expect(groups).toHaveLength(1);
    expect(groups[0].citations.map((c) => c.paper)).toEqual([p1, p3, p5]);
  });

  it("finds every singleton match in a multi-citation sentence by position", () => {
    const p1 = mkPaper("A", 1);
    const p2 = mkPaper("B", 2);
    const p3 = mkPaper("C", 3);
    const groups = resolvePaperReferences(
      "Compare [P1] and [P2], then contrast with [P3].",
      [p1, p2, p3],
    );
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.citations[0].paper)).toEqual([p1, p2, p3]);
  });

  it("expands combined-bracket form [P1, P2, P3] into one group with three position-resolved citations", () => {
    const papers = [
      mkPaper("A", 1),
      mkPaper("B", 2),
      mkPaper("C", 3),
      mkPaper("D", 4),
    ];
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
    const papers = [mkPaper("A", 1), mkPaper("B", 2), mkPaper("C", 3)];
    const tight = resolvePaperReferences("[P1,P2]", papers);
    const loose = resolvePaperReferences("[P1,  P2,   P3]", papers);

    expect(tight).toHaveLength(1);
    expect(tight[0].citations.map((c) => c.index)).toEqual([1, 2]);

    expect(loose).toHaveLength(1);
    expect(loose[0].citations.map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it("resolves large combined groups (Gemini observed up to 10)", () => {
    const papers = Array.from({ length: 12 }, (_, i) =>
      mkPaper(`P${i + 1}`, i + 1),
    );
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
    const papers = [mkPaper("A", 1)];
    const groups = resolvePaperReferences("See [p1] for context.", papers);
    expect(groups).toHaveLength(1);
    expect(groups[0].citations[0].index).toBe(1);
    expect(groups[0].citations[0].paper).toBe(papers[0]);
  });

  it("accepts lowercase drift variant even with a gap-containing array", () => {
    const p1 = mkPaper("A", 1);
    const p3 = mkPaper("C", 3);
    const groups = resolvePaperReferences("See [p3].", [p1, p3]);
    expect(groups[0].citations[0].paper).toBe(p3);
  });

  it("mixes singleton and combined groups in one text", () => {
    const papers = [
      mkPaper("A", 1),
      mkPaper("B", 2),
      mkPaper("C", 3),
      mkPaper("D", 4),
    ];
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
    const papers = [mkPaper("A", 1), mkPaper("B", 2)];
    const text = "prefix [P1, P2] suffix";
    const [group] = resolvePaperReferences(text, papers);
    const before = text.slice(0, group.start);
    const after = text.slice(group.end);
    expect(before).toBe("prefix ");
    expect(after).toBe(" suffix");
    expect(group.raw).toBe("[P1, P2]");
  });

  it("ignores malformed brackets (no P prefix)", () => {
    const papers = [mkPaper("A", 1)];
    expect(resolvePaperReferences("See [1] for details.", papers)).toEqual([]);
  });

  it("ignores bare Pn outside of brackets", () => {
    const papers = [mkPaper("A", 1)];
    expect(resolvePaperReferences("See P1 for details.", papers)).toEqual([]);
  });

  it("does not leak regex state across calls", () => {
    const papers = [mkPaper("A", 1), mkPaper("B", 2)];
    const first = resolvePaperReferences("[P1]", papers);
    const second = resolvePaperReferences("[P2]", papers);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].citations[0].index).toBe(1);
    expect(second[0].citations[0].index).toBe(2);
  });

  it("partially resolves a combined group when one position is out of range", () => {
    const papers = [mkPaper("A", 1), mkPaper("B", 2)];
    const [group] = resolvePaperReferences("[P1, P5, P2]", papers);
    expect(group.citations).toHaveLength(3);
    expect(group.citations[0].paper).toBe(papers[0]);
    expect(group.citations[1].paper).toBeNull();
    expect(group.citations[2].paper).toBe(papers[1]);
  });

  it("does not mutate the papers array it inspects", () => {
    const papers = [mkPaper("A", 1), mkPaper("B", 2)];
    const before = papers.map((p) => ({ ...p }));
    resolvePaperReferences("See [P1] and [P2].", papers);
    expect(papers.map((p) => ({ ...p }))).toEqual(before);
  });

  it("carries included=false through to the resolved paper", () => {
    const excluded = mkPaper("X", 1, { included: false });
    const [group] = resolvePaperReferences("See [P1].", [excluded]);
    expect(group.citations[0].paper).not.toBeNull();
    expect(group.citations[0].paper!.included).toBe(false);
  });

  it("carries included=true through to the resolved paper", () => {
    const included = mkPaper("X", 1, { included: true });
    const [group] = resolvePaperReferences("See [P1].", [included]);
    expect(group.citations[0].paper!.included).toBe(true);
  });
});
