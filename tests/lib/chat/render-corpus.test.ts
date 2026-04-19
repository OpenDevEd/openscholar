import { describe, it, expect } from "vitest";
import {
  filterAndPreservePositions,
  renderPaperCorpus,
  sortPapersForCorpus,
  type CorpusSource,
  type PaperForCorpus,
} from "@/lib/chat/render-corpus";

const p = (
  openalexId: string | undefined,
  title: string,
  authors: string[] = ["Doe"],
  year = 2024,
  abstract: string | undefined = "abs",
): PaperForCorpus => ({ openalexId, title, authors, year, abstract });

describe("renderPaperCorpus", () => {
  it("produces byte-deterministic output for the same inputs", () => {
    const papers = [
      p("W3", "Third"),
      p("W1", "First"),
      p("W2", "Second"),
    ];
    const a = renderPaperCorpus(papers);
    const b = renderPaperCorpus([papers[2], papers[0], papers[1]]);
    expect(a).toBe(b);
  });

  it("sorts by openalexId ascending; indexes start at P1", () => {
    const out = renderPaperCorpus([
      p("W9", "NinthAlpha"),
      p("W1", "FirstAlpha"),
    ]);
    expect(out.indexOf('id="P1"')).toBeLessThan(out.indexOf('id="P2"'));
    expect(out).toContain('<title>FirstAlpha</title>');
    // The first block wins P1 — must be the one with lowest openalexId.
    const firstBlock = out.split("\n\n")[0];
    expect(firstBlock).toContain('openalex="W1"');
  });

  it("renders (no abstract available) for missing abstracts", () => {
    const out = renderPaperCorpus([
      { openalexId: "W1", title: "T", authors: ["A"], year: 2024 },
    ]);
    expect(out).toContain("<abstract>(no abstract available)</abstract>");
  });

  it("escapes XML-special characters in title and authors", () => {
    const out = renderPaperCorpus([
      p("W1", "Ampersand & <tag>", ['Smith <"D">']),
    ]);
    expect(out).toContain("&amp;");
    expect(out).toContain("&lt;tag&gt;");
    expect(out).toContain("&quot;");
  });

  it("falls back to Unknown for empty authors / year", () => {
    const out = renderPaperCorpus([
      { openalexId: "W1", title: "t", authors: [], abstract: "x" },
    ]);
    expect(out).toContain("<authors>Unknown</authors>");
    expect(out).toContain("<year>Unknown</year>");
  });
});

const cs = (
  sourceId: string,
  position: number,
  overrides: Partial<CorpusSource> = {},
): CorpusSource => ({
  sourceId,
  position,
  openalexId: `W${position}`,
  title: `Paper ${position}`,
  authors: ["Doe"],
  year: 2024,
  abstract: "abs",
  ...overrides,
});

describe("filterAndPreservePositions", () => {
  it("returns [] for empty input and empty includedSourceIds", () => {
    expect(filterAndPreservePositions([], new Set<string>())).toEqual([]);
  });

  it("emits every source with promptIds P1..Pn when all are included", () => {
    const sources = [cs("s1", 1), cs("s2", 2), cs("s3", 3)];
    const included = new Set(["s1", "s2", "s3"]);
    const out = filterAndPreservePositions(sources, included);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.promptId)).toEqual(["P1", "P2", "P3"]);
    expect(out.map((r) => r.sourceId)).toEqual(["s1", "s2", "s3"]);
  });

  it("preserves positional IDs across gaps when a middle source is excluded", () => {
    const sources = [cs("s1", 1), cs("s2", 2), cs("s3", 3)];
    const included = new Set(["s1", "s3"]);
    const out = filterAndPreservePositions(sources, included);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.promptId)).toEqual(["P1", "P3"]);
    expect(out.map((r) => r.sourceId)).toEqual(["s1", "s3"]);
  });

  it("sorts output by position ascending even when input is unsorted", () => {
    const sources = [cs("s3", 3), cs("s1", 1), cs("s2", 2)];
    const included = new Set(["s1", "s2", "s3"]);
    const out = filterAndPreservePositions(sources, included);
    expect(out.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(out.map((r) => r.promptId)).toEqual(["P1", "P2", "P3"]);
  });

  it("still filters correctly when duplicate positions exist in input", () => {
    // Upstream data bug: two rows share position 2. Helper filters by
    // sourceId membership regardless and does not dedupe on its own —
    // uniqueness is the caller's responsibility.
    const sources = [cs("s1", 1), cs("s2a", 2), cs("s2b", 2)];
    const included = new Set(["s1", "s2b"]);
    const out = filterAndPreservePositions(sources, included);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.sourceId).sort()).toEqual(["s1", "s2b"]);
  });

  it("drops sources whose sourceId is absent from includedSourceIds", () => {
    const sources = [cs("a", 1), cs("b", 2), cs("c", 3), cs("d", 4)];
    const included = new Set(["b", "d"]);
    const out = filterAndPreservePositions(sources, included);
    expect(out.map((r) => r.sourceId)).toEqual(["b", "d"]);
    expect(out.map((r) => r.promptId)).toEqual(["P2", "P4"]);
  });

  it("derives promptId from position, not array index (P7 for the lone surviving position 7)", () => {
    // Critical invariant: under the old array-index scheme, a single
    // element would always get P1. Under position-anchoring, a lone
    // surviving row at position 7 keeps promptId "P7".
    const sources = [cs("lone", 7)];
    const included = new Set(["lone"]);
    const out = filterAndPreservePositions(sources, included);
    expect(out).toHaveLength(1);
    expect(out[0].promptId).toBe("P7");
  });
});

describe("sortPapersForCorpus", () => {
  it("places papers without openalexId at the end, preserving original order among them", () => {
    const papers: PaperForCorpus[] = [
      { title: "noId-a", authors: [], abstract: "x" },
      { openalexId: "W2", title: "withId", authors: [], abstract: "x" },
      { title: "noId-b", authors: [], abstract: "x" },
      { openalexId: "W1", title: "withId2", authors: [], abstract: "x" },
    ];
    const sorted = sortPapersForCorpus(papers);
    expect(sorted.map((p) => p.title)).toEqual([
      "withId2",
      "withId",
      "noId-a",
      "noId-b",
    ]);
  });
});
