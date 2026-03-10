import { describe, it, expect, beforeEach } from "vitest";
import {
  buildSynonymMap,
  groupAnswersBySynonym,
  mergeDisagreementClusters,
} from "../lib/extraction/answer-grouping";
import type { GroupedAnswer, SynonymMap } from "../lib/extraction/answer-grouping";
import type { DisagreementCluster, CitationStatusMix } from "../lib/extraction/insights";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeMix(partial: Partial<CitationStatusMix> = {}): CitationStatusMix {
  return {
    grounded: 0,
    best_effort: 0,
    insufficient_evidence: 0,
    extraction_error: 0,
    ...partial,
  };
}

function makeCluster(
  normalizedAnswer: string,
  displayAnswer: string,
  count: number,
  avgConfidence = 0.8,
  mix: Partial<CitationStatusMix> = {},
  examples: DisagreementCluster["examples"] = []
): DisagreementCluster {
  return {
    normalizedAnswer,
    displayAnswer,
    count,
    avgConfidence,
    citationStatusMix: makeMix(mix),
    examples,
  };
}

// ────────────────────────────────────────────────────────────
// buildSynonymMap
// ────────────────────────────────────────────────────────────

describe("buildSynonymMap", () => {
  let map: SynonymMap;

  beforeEach(() => {
    map = buildSynonymMap();
  });

  it("maps boolean yes-group synonyms to 'yes'", () => {
    expect(map.get("yes")).toBe("yes");
    expect(map.get("true")).toBe("yes");
    expect(map.get("positive")).toBe("yes");
    expect(map.get("affirmative")).toBe("yes");
  });

  it("maps boolean no-group synonyms to 'no'", () => {
    expect(map.get("no")).toBe("no");
    expect(map.get("false")).toBe("no");
    expect(map.get("negative")).toBe("no");
    expect(map.get("incorrect")).toBe("no");
  });

  it("maps null/missing synonyms to 'n/a'", () => {
    expect(map.get("n/a")).toBe("n/a");
    expect(map.get("na")).toBe("n/a");
    expect(map.get("not applicable")).toBe("n/a");
    expect(map.get("unknown")).toBe("n/a");
    expect(map.get("none")).toBe("n/a");
    expect(map.get("no data")).toBe("n/a");
    expect(map.get("not available")).toBe("n/a");
    expect(map.get("—")).toBe("n/a");
  });

  it("does not map arbitrary answers not in synonym list", () => {
    expect(map.get("model")).toBeUndefined();
    expect(map.get("models")).toBeUndefined();
    expect(map.get("transformer")).toBeUndefined();
    expect(map.get("bert")).toBeUndefined();
  });

  it("singular/plural pairs are NOT grouped (e.g., model vs models)", () => {
    // Both should be absent from the map (no synonym resolution)
    expect(map.get("model")).toBeUndefined();
    expect(map.get("models")).toBeUndefined();
  });

  it("returns a Map instance", () => {
    expect(map).toBeInstanceOf(Map);
  });
});

// ────────────────────────────────────────────────────────────
// groupAnswersBySynonym
// ────────────────────────────────────────────────────────────

describe("groupAnswersBySynonym", () => {
  let synonymMap: SynonymMap;

  beforeEach(() => {
    synonymMap = buildSynonymMap();
  });

  it("groups 'yes', 'true', and 'positive' into a single group", () => {
    const answers = [
      { normalized: "yes", display: "Yes", count: 5, citationStatusMix: makeMix({ grounded: 5 }) },
      { normalized: "true", display: "True", count: 3, citationStatusMix: makeMix({ best_effort: 3 }) },
      { normalized: "positive", display: "Positive", count: 2, citationStatusMix: makeMix({ insufficient_evidence: 2 }) },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    expect(result).toHaveLength(1);
    expect(result[0].groupNormalized).toBe("yes");
  });

  it("group count is the sum of all variant counts", () => {
    const answers = [
      { normalized: "yes", display: "Yes", count: 5 },
      { normalized: "true", display: "True", count: 3 },
      { normalized: "positive", display: "Positive", count: 2 },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    expect(result[0].count).toBe(10); // 5 + 3 + 2
  });

  it("group citationStatusMix aggregates across all variants (not just representative)", () => {
    const answers = [
      { normalized: "yes", display: "Yes", count: 5, citationStatusMix: makeMix({ grounded: 5 }) },
      { normalized: "true", display: "True", count: 3, citationStatusMix: makeMix({ best_effort: 3 }) },
      { normalized: "positive", display: "Positive", count: 2, citationStatusMix: makeMix({ insufficient_evidence: 2 }) },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    const mix = result[0].citationStatusMix;
    expect(mix.grounded).toBe(5);
    expect(mix.best_effort).toBe(3);
    expect(mix.insufficient_evidence).toBe(2);
    expect(mix.extraction_error).toBe(0);
  });

  it("representative is the variant with the highest count", () => {
    const answers = [
      { normalized: "true", display: "True", count: 3 },
      { normalized: "yes", display: "Yes", count: 5 },
      { normalized: "positive", display: "Positive", count: 2 },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    // "yes" has the highest count (5), so it should be the representative
    expect(result[0].groupRepresentative).toBe("Yes");
  });

  it("single-variant groups have variants.length === 1", () => {
    const answers = [
      { normalized: "model", display: "Model", count: 4 },
      { normalized: "bert", display: "BERT", count: 2 },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    for (const group of result) {
      expect(group.variants).toHaveLength(1);
    }
  });

  it("answers not in the synonym map are grouped by their own normalized key", () => {
    const answers = [
      { normalized: "transformer", display: "Transformer", count: 7 },
      { normalized: "bert", display: "BERT", count: 3 },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    expect(result).toHaveLength(2);
    const groupKeys = result.map((g) => g.groupNormalized);
    expect(groupKeys).toContain("transformer");
    expect(groupKeys).toContain("bert");
  });

  it("output is sorted by group count descending", () => {
    const answers = [
      { normalized: "bert", display: "BERT", count: 2 },
      { normalized: "yes", display: "Yes", count: 5 },
      { normalized: "true", display: "True", count: 3 },
      { normalized: "transformer", display: "Transformer", count: 8 },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    const counts = result.map((g) => g.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("variants within each group are sorted by count descending", () => {
    const answers = [
      { normalized: "true", display: "True", count: 3 },
      { normalized: "affirmative", display: "Affirmative", count: 1 },
      { normalized: "yes", display: "Yes", count: 5 },
      { normalized: "positive", display: "Positive", count: 2 },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    const yesGroup = result.find((g) => g.groupNormalized === "yes")!;
    const variantCounts = yesGroup.variants.map((v) => v.count);
    expect(variantCounts).toEqual([...variantCounts].sort((a, b) => b - a));
  });

  it("missing citationStatusMix defaults to all-zero mix", () => {
    const answers = [
      { normalized: "yes", display: "Yes", count: 5 },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    expect(result[0].citationStatusMix).toEqual(makeMix());
  });

  it("empty input returns empty output", () => {
    const result = groupAnswersBySynonym([], synonymMap);
    expect(result).toEqual([]);
  });

  it("all unique answers produce one group each", () => {
    const answers = [
      { normalized: "alpha", display: "Alpha", count: 3 },
      { normalized: "beta", display: "Beta", count: 2 },
      { normalized: "gamma", display: "Gamma", count: 1 },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    expect(result).toHaveLength(3);
  });

  it("groups null-like answers ('n/a', 'unknown', 'none') into a single n/a group", () => {
    const answers = [
      { normalized: "n/a", display: "N/A", count: 4 },
      { normalized: "unknown", display: "Unknown", count: 2 },
      { normalized: "none", display: "None", count: 1 },
    ];
    const result = groupAnswersBySynonym(answers, synonymMap);
    expect(result).toHaveLength(1);
    expect(result[0].groupNormalized).toBe("n/a");
    expect(result[0].count).toBe(7); // 4 + 2 + 1
  });
});

// ────────────────────────────────────────────────────────────
// mergeDisagreementClusters
// ────────────────────────────────────────────────────────────

describe("mergeDisagreementClusters", () => {
  let synonymMap: SynonymMap;

  beforeEach(() => {
    synonymMap = buildSynonymMap();
  });

  it("merges 'yes' and 'true' clusters into one cluster", () => {
    const clusters = [
      makeCluster("yes", "Yes", 5),
      makeCluster("true", "True", 3),
    ];
    const result = mergeDisagreementClusters(clusters, synonymMap);
    expect(result).toHaveLength(1);
    expect(result[0].normalizedAnswer).toBe("yes");
  });

  it("merged cluster count equals sum of original counts", () => {
    const clusters = [
      makeCluster("yes", "Yes", 5),
      makeCluster("true", "True", 3),
    ];
    const result = mergeDisagreementClusters(clusters, synonymMap);
    expect(result[0].count).toBe(8);
  });

  it("merged cluster displayAnswer comes from highest-count cluster", () => {
    const clusters = [
      makeCluster("true", "True", 3),
      makeCluster("yes", "Yes", 5),
    ];
    const result = mergeDisagreementClusters(clusters, synonymMap);
    expect(result[0].displayAnswer).toBe("Yes");
  });

  it("merged citationStatusMix sums across all merged clusters", () => {
    const clusters = [
      makeCluster("yes", "Yes", 5, 0.8, { grounded: 4, best_effort: 1 }),
      makeCluster("true", "True", 3, 0.7, { grounded: 2, extraction_error: 1 }),
    ];
    const result = mergeDisagreementClusters(clusters, synonymMap);
    const mix = result[0].citationStatusMix;
    expect(mix.grounded).toBe(6);
    expect(mix.best_effort).toBe(1);
    expect(mix.extraction_error).toBe(1);
    expect(mix.insufficient_evidence).toBe(0);
  });

  it("merged avgConfidence is weighted average by count", () => {
    const clusters = [
      makeCluster("yes", "Yes", 5, 0.8),
      makeCluster("true", "True", 3, 0.6),
    ];
    const result = mergeDisagreementClusters(clusters, synonymMap);
    // weighted avg: (5 * 0.8 + 3 * 0.6) / 8 = (4.0 + 1.8) / 8 = 5.8 / 8 = 0.725
    expect(result[0].avgConfidence).toBeCloseTo(0.725);
  });

  it("merged examples include examples from all original clusters", () => {
    const examplesYes = [
      { paperId: "p1", title: "Paper 1", openalexId: "W1", answer: "Yes" as const, confidence: 0.9 },
      { paperId: "p2", title: "Paper 2", openalexId: "W2", answer: "Yes" as const, confidence: 0.8 },
    ];
    const examplesTrue = [
      { paperId: "p3", title: "Paper 3", openalexId: "W3", answer: "True" as const, confidence: 0.7 },
    ];
    const clusters = [
      makeCluster("yes", "Yes", 5, 0.8, {}, examplesYes),
      makeCluster("true", "True", 3, 0.7, {}, examplesTrue),
    ];
    const result = mergeDisagreementClusters(clusters, synonymMap);
    expect(result[0].examples).toHaveLength(3);
    const paperIds = result[0].examples.map((e) => e.paperId);
    expect(paperIds).toContain("p1");
    expect(paperIds).toContain("p2");
    expect(paperIds).toContain("p3");
  });

  it("single-cluster groups are returned unchanged (no merging)", () => {
    const clusters = [
      makeCluster("yes", "Yes", 5),
      makeCluster("no", "No", 3),
    ];
    const result = mergeDisagreementClusters(clusters, synonymMap);
    // "yes" and "no" are different synonym groups — should remain separate
    expect(result).toHaveLength(2);
  });

  it("clusters not in the synonym map are grouped by their own normalized key", () => {
    const clusters = [
      makeCluster("model", "Model", 4),
      makeCluster("transformer", "Transformer", 2),
    ];
    const result = mergeDisagreementClusters(clusters, synonymMap);
    expect(result).toHaveLength(2);
  });

  it("empty input returns empty output", () => {
    const result = mergeDisagreementClusters([], synonymMap);
    expect(result).toEqual([]);
  });

  it("output is sorted by count descending", () => {
    const clusters = [
      makeCluster("yes", "Yes", 5),
      makeCluster("true", "True", 3),
      makeCluster("transformer", "Transformer", 10),
    ];
    const result = mergeDisagreementClusters(clusters, synonymMap);
    const counts = result.map((c) => c.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});
