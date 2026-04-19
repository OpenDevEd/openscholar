import { describe, it, expect } from "vitest";
import {
  filterAndPreservePositions,
  renderPaperCorpus,
  type CorpusSource,
  type CorpusSourceForPrompt,
} from "@/lib/chat/render-corpus";

const prompted = (
  position: number,
  overrides: Partial<CorpusSourceForPrompt> = {},
): CorpusSourceForPrompt => ({
  sourceId: `s${position}`,
  position,
  promptId: `P${position}`,
  openalexId: `W${position}`,
  title: `Paper ${position}`,
  authors: ["Doe"],
  year: 2024,
  abstract: "abs",
  ...overrides,
});

describe("renderPaperCorpus", () => {
  it("emits <papers count=\"0\"></papers> for empty input (no throw)", () => {
    expect(renderPaperCorpus([])).toBe('<papers count="0"></papers>');
  });

  it("preserves positional gaps — P1 and P3 present, P2 absent", () => {
    const out = renderPaperCorpus([prompted(1), prompted(3)]);
    expect(out).toMatch(/<papers count="2">/);
    expect(out).toContain('id="P1"');
    expect(out).toContain('id="P3"');
    expect(out).not.toContain('id="P2"');
  });

  it("renders (no abstract available) for missing abstracts", () => {
    const out = renderPaperCorpus([
      prompted(1, { abstract: undefined }),
    ]);
    expect(out).toContain("<abstract>(no abstract available)</abstract>");
  });

  it("falls back to Unknown for empty authors / year", () => {
    const out = renderPaperCorpus([
      prompted(1, { authors: [], year: undefined }),
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

  it("does not mutate the input array or its element identities", () => {
    // Purity guard: calling the helper must not reorder or rewrite the
    // caller's source array. Two back-to-back calls must return
    // equivalent outputs.
    const sources: ReadonlyArray<CorpusSource> = Object.freeze([
      cs("s3", 3),
      cs("s1", 1),
      cs("s2", 2),
    ]);
    const before = sources.map((s) => s);
    const included = new Set(["s1", "s2", "s3"]);
    const a = filterAndPreservePositions(sources, included);
    const b = filterAndPreservePositions(sources, included);
    expect(sources).toEqual(before);
    expect(sources[0].sourceId).toBe("s3");
    expect(a).toEqual(b);
  });
});

