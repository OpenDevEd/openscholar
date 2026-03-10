import { describe, expect, it } from "vitest";
import {
  aggregateQuestionInsights,
  buildArrayAnswerProfileClusters,
  buildDisagreementClusters,
  buildRunDiff,
} from "../lib/extraction/insights";
import type { CitationStatus, InsightEntry, RunDiffRecord } from "../lib/extraction/insights";

describe("aggregateQuestionInsights", () => {
  it("computes coverage, confidence, and citation status mix", () => {
    const aggregate = aggregateQuestionInsights(
      [
        {
          paperId: "p1",
          title: "Paper 1",
          openalexId: "oa:1",
          questionKey: "sample_size",
          answer: "273 studies",
          confidence: 0.92,
          citationStatus: "grounded",
          reviewState: "accepted",
        },
        {
          paperId: "p2",
          title: "Paper 2",
          openalexId: "oa:2",
          questionKey: "sample_size",
          answer: null,
          confidence: 0.21,
          citationStatus: "insufficient_evidence",
          reviewState: "unreviewed",
        },
        {
          paperId: "p3",
          title: "Paper 3",
          openalexId: "oa:3",
          questionKey: "sample_size",
          answer: "270 studies",
          confidence: 0.55,
          citationStatus: "best_effort",
          reviewState: "needs_followup",
        },
      ],
      "string"
    );

    expect(aggregate.total).toBe(3);
    expect(aggregate.answered).toBe(2);
    expect(aggregate.grounded).toBe(1);
    expect(aggregate.citationStatusMix.grounded).toBe(1);
    expect(aggregate.citationStatusMix.best_effort).toBe(1);
    expect(aggregate.citationStatusMix.insufficient_evidence).toBe(1);
    expect(aggregate.topAnswers.length).toBeGreaterThan(0);
    expect(aggregate.avgEffectiveConfidence).toBeGreaterThan(0);
    expect(aggregate.avgEffectiveConfidence).toBeLessThan(aggregate.avgConfidence);
    expect(aggregate.reviewed.accepted).toBe(1);
    expect(aggregate.reviewed.needsFollowup).toBe(1);
  });

  it("builds entity distribution for array questions with canonicalized values", () => {
    const aggregate = aggregateQuestionInsights(
      [
        {
          paperId: "p1",
          title: "Paper 1",
          openalexId: "oa:1",
          questionKey: "models",
          answer: ["GPT-4", "Machine Learning", "GPT-4; ChatGPT"],
          confidence: 0.9,
          citationStatus: "grounded",
        },
        {
          paperId: "p2",
          title: "Paper 2",
          openalexId: "oa:2",
          questionKey: "models",
          answer: ["gpt-4, transformers"],
          confidence: 0.75,
          citationStatus: "grounded",
        },
        {
          paperId: "p3",
          title: "Paper 3",
          openalexId: "oa:3",
          questionKey: "models",
          answer: ["CodeLlama", "deep learning"],
          confidence: 0.6,
          citationStatus: "best_effort",
        },
      ],
      "array"
    );

    expect(aggregate.insightMode).toBe("array");
    expect(aggregate.entityDistribution.length).toBeGreaterThan(0);
    const gpt4 = aggregate.entityDistribution.find((entity) => entity.entity === "gpt-4");
    expect(gpt4?.count).toBe(2);
    const machineLearning = aggregate.entityDistribution.find(
      (entity) => entity.entity === "machine learning"
    );
    expect(machineLearning?.generic).toBe(true);
  });
});

describe("buildDisagreementClusters", () => {
  it("returns multiple clusters when answers conflict", () => {
    const clusters = buildDisagreementClusters(
      [
        {
          paperId: "p1",
          title: "Paper 1",
          openalexId: "oa:1",
          questionKey: "direction",
          answer: "increase",
          confidence: 0.88,
          citationStatus: "grounded",
        },
        {
          paperId: "p2",
          title: "Paper 2",
          openalexId: "oa:2",
          questionKey: "direction",
          answer: "decrease",
          confidence: 0.82,
          citationStatus: "grounded",
        },
        {
          paperId: "p3",
          title: "Paper 3",
          openalexId: "oa:3",
          questionKey: "direction",
          answer: "increase",
          confidence: 0.71,
          citationStatus: "best_effort",
        },
      ],
      "string"
    );

    expect(clusters.length).toBe(2);
    expect(clusters[0].count).toBeGreaterThanOrEqual(clusters[1].count);
  });

  it("suppresses singleton array profiles when meaningful clusters exist", () => {
    const profiles = buildArrayAnswerProfileClusters(
      [
        {
          paperId: "p1",
          title: "Paper 1",
          openalexId: "oa:1",
          questionKey: "models",
          answer: ["GPT-4", "GitHub Copilot"],
          confidence: 0.9,
          citationStatus: "grounded",
        },
        {
          paperId: "p2",
          title: "Paper 2",
          openalexId: "oa:2",
          questionKey: "models",
          answer: ["github copilot", "gpt-4"],
          confidence: 0.85,
          citationStatus: "grounded",
        },
        {
          paperId: "p3",
          title: "Paper 3",
          openalexId: "oa:3",
          questionKey: "models",
          answer: ["CodeLlama"],
          confidence: 0.7,
          citationStatus: "best_effort",
        },
      ],
      { minClusterSize: 2, maxClusters: 20 }
    );

    expect(profiles.clusters.length).toBe(1);
    expect(profiles.suppressedSingletonCount).toBeGreaterThan(0);
  });
});

describe("buildRunDiff", () => {
  it("tracks new, changed, removed, and confidence-shift outcomes", () => {
    const baseline = [
      {
        key: "oa:1::sample_size",
        openalexId: "oa:1",
        title: "Paper 1",
        questionKey: "sample_size",
        answer: "273",
        confidence: 0.9,
        citationStatus: "grounded" as const,
      },
      {
        key: "oa:2::sample_size",
        openalexId: "oa:2",
        title: "Paper 2",
        questionKey: "sample_size",
        answer: "300",
        confidence: 0.8,
        citationStatus: "grounded" as const,
      },
    ];
    const next = [
      {
        key: "oa:1::sample_size",
        openalexId: "oa:1",
        title: "Paper 1",
        questionKey: "sample_size",
        answer: "273",
        confidence: 0.6,
        citationStatus: "grounded" as const,
      },
      {
        key: "oa:2::sample_size",
        openalexId: "oa:2",
        title: "Paper 2",
        questionKey: "sample_size",
        answer: null,
        confidence: 0.2,
        citationStatus: "insufficient_evidence" as const,
      },
      {
        key: "oa:3::sample_size",
        openalexId: "oa:3",
        title: "Paper 3",
        questionKey: "sample_size",
        answer: "120",
        confidence: 0.9,
        citationStatus: "best_effort" as const,
      },
    ];

    const { summary } = buildRunDiff(baseline, next, 0.15);
    expect(summary.totalCompared).toBe(3);
    expect(summary.newAnswers).toBe(1);
    expect(summary.removedAnswers).toBe(1);
    expect(summary.confidenceShifts).toBeGreaterThanOrEqual(1);
    expect(summary.newlyInsufficientEvidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge case tests (appended -- existing tests above are NOT modified)
// ---------------------------------------------------------------------------

describe("aggregateQuestionInsights edge cases", () => {
  it("handles empty entries array gracefully", () => {
    const aggregate = aggregateQuestionInsights([], "string");

    expect(aggregate.total).toBe(0);
    expect(aggregate.answered).toBe(0);
    expect(aggregate.grounded).toBe(0);
    expect(aggregate.avgConfidence).toBe(0);
    expect(aggregate.avgEffectiveConfidence).toBe(0);
    expect(aggregate.topAnswers).toEqual([]);
    expect(aggregate.entityDistribution).toEqual([]);
    expect(aggregate.confidenceBuckets).toEqual({
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    });
    expect(aggregate.citationStatusMix).toEqual({
      grounded: 0,
      best_effort: 0,
      insufficient_evidence: 0,
      extraction_error: 0,
    });
    expect(aggregate.reviewed).toEqual({
      accepted: 0,
      rejected: 0,
      needsFollowup: 0,
      unreviewed: 0,
    });
  });

  it("handles all-null answers", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Paper 1",
        openalexId: "oa:1",
        questionKey: "q1",
        answer: null,
        confidence: 0.9,
        citationStatus: "grounded",
      },
      {
        paperId: "p2",
        title: "Paper 2",
        openalexId: "oa:2",
        questionKey: "q1",
        answer: null,
        confidence: 0.5,
        citationStatus: "best_effort",
      },
      {
        paperId: "p3",
        title: "Paper 3",
        openalexId: "oa:3",
        questionKey: "q1",
        answer: null,
        confidence: 0.2,
        citationStatus: "insufficient_evidence",
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "string");

    expect(aggregate.total).toBe(3);
    expect(aggregate.answered).toBe(0);
    expect(aggregate.topAnswers).toEqual([]);
    // Confidence and citation status are still tracked for all entries
    expect(aggregate.citationStatusMix.grounded).toBe(1);
    expect(aggregate.citationStatusMix.best_effort).toBe(1);
    expect(aggregate.citationStatusMix.insufficient_evidence).toBe(1);
  });

  it("handles all-undefined answers", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Paper 1",
        openalexId: "oa:1",
        questionKey: "q1",
        answer: undefined,
      },
      {
        paperId: "p2",
        title: "Paper 2",
        openalexId: "oa:2",
        questionKey: "q1",
        answer: undefined,
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "string");

    expect(aggregate.total).toBe(2);
    expect(aggregate.answered).toBe(0);
  });

  it("handles undefined confidence (missing field)", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Paper 1",
        openalexId: "oa:1",
        questionKey: "q1",
        answer: "yes",
      },
      {
        paperId: "p2",
        title: "Paper 2",
        openalexId: "oa:2",
        questionKey: "q1",
        answer: "no",
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "string");

    expect(aggregate.avgConfidence).toBe(0);
    expect(aggregate.confidenceBuckets.unknown).toBe(2);
  });

  it("handles undefined citationStatus", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Paper 1",
        openalexId: "oa:1",
        questionKey: "q1",
        answer: "yes",
        confidence: 0.8,
      },
      {
        paperId: "p2",
        title: "Paper 2",
        openalexId: "oa:2",
        questionKey: "q1",
        answer: "no",
        confidence: 0.7,
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "string");

    // addCitationStatus returns early on falsy status
    expect(aggregate.citationStatusMix.grounded).toBe(0);
    expect(aggregate.citationStatusMix.best_effort).toBe(0);
    expect(aggregate.citationStatusMix.insufficient_evidence).toBe(0);
    expect(aggregate.citationStatusMix.extraction_error).toBe(0);
    expect(aggregate.grounded).toBe(0);
  });

  it("handles empty string answers", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Paper 1",
        openalexId: "oa:1",
        questionKey: "q1",
        answer: "",
        confidence: 0.8,
        citationStatus: "grounded",
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "string");

    // normalizeAnswer("") returns null because normalizeText("") returns ""
    expect(aggregate.answered).toBe(0);
  });

  it("handles mixed null and valid answers for array type", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Paper 1",
        openalexId: "oa:1",
        questionKey: "models",
        answer: ["GPT-4"],
        confidence: 0.9,
        citationStatus: "grounded",
      },
      {
        paperId: "p2",
        title: "Paper 2",
        openalexId: "oa:2",
        questionKey: "models",
        answer: null,
        confidence: 0.5,
      },
      {
        paperId: "p3",
        title: "Paper 3",
        openalexId: "oa:3",
        questionKey: "models",
        answer: undefined,
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "array");

    expect(aggregate.total).toBe(3);
    expect(aggregate.answered).toBe(1);
    const gpt4 = aggregate.entityDistribution.find((e) => e.entity === "gpt-4");
    expect(gpt4?.count).toBe(1);
  });
});

describe("buildDisagreementClusters edge cases", () => {
  it("returns empty array for empty entries", () => {
    const result = buildDisagreementClusters([], "string");
    expect(result).toEqual([]);
  });

  it("returns empty array when all answers are the same", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Paper 1",
        openalexId: "oa:1",
        questionKey: "q1",
        answer: "yes",
        confidence: 0.9,
      },
      {
        paperId: "p2",
        title: "Paper 2",
        openalexId: "oa:2",
        questionKey: "q1",
        answer: "yes",
        confidence: 0.8,
      },
      {
        paperId: "p3",
        title: "Paper 3",
        openalexId: "oa:3",
        questionKey: "q1",
        answer: "yes",
        confidence: 0.7,
      },
    ];

    const result = buildDisagreementClusters(entries, "string");
    // groups.size <= 1, so returns []
    expect(result).toEqual([]);
  });

  it("returns empty array when all answers are null", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Paper 1",
        openalexId: "oa:1",
        questionKey: "q1",
        answer: null,
      },
      {
        paperId: "p2",
        title: "Paper 2",
        openalexId: "oa:2",
        questionKey: "q1",
        answer: null,
      },
      {
        paperId: "p3",
        title: "Paper 3",
        openalexId: "oa:3",
        questionKey: "q1",
        answer: null,
      },
    ];

    const result = buildDisagreementClusters(entries, "string");
    // normalized is null, all skipped, groups.size === 0
    expect(result).toEqual([]);
  });
});

describe("buildRunDiff edge cases", () => {
  it("handles empty baseline and next", () => {
    const { summary, changes } = buildRunDiff([], [], 0.2);

    expect(summary.totalCompared).toBe(0);
    expect(summary.newAnswers).toBe(0);
    expect(summary.removedAnswers).toBe(0);
    expect(summary.changedAnswers).toBe(0);
    expect(summary.confidenceShifts).toBe(0);
    expect(summary.newlyInsufficientEvidence).toBe(0);
    expect(changes).toEqual([]);
  });

  it("handles all-removed (baseline only, empty next)", () => {
    const baseline: RunDiffRecord[] = [
      {
        key: "oa:1::q1",
        openalexId: "oa:1",
        title: "Paper 1",
        questionKey: "q1",
        answer: "yes",
        confidence: 0.9,
        citationStatus: "grounded",
      },
      {
        key: "oa:2::q1",
        openalexId: "oa:2",
        title: "Paper 2",
        questionKey: "q1",
        answer: "no",
        confidence: 0.8,
        citationStatus: "grounded",
      },
    ];

    const { summary } = buildRunDiff(baseline, [], 0.2);

    expect(summary.removedAnswers).toBe(2);
    expect(summary.newAnswers).toBe(0);
    expect(summary.totalCompared).toBe(2);
  });

  it("handles all-new (empty baseline, next only)", () => {
    const next: RunDiffRecord[] = [
      {
        key: "oa:1::q1",
        openalexId: "oa:1",
        title: "Paper 1",
        questionKey: "q1",
        answer: "yes",
        confidence: 0.85,
        citationStatus: "grounded",
      },
      {
        key: "oa:2::q1",
        openalexId: "oa:2",
        title: "Paper 2",
        questionKey: "q1",
        answer: "no",
        confidence: 0.75,
        citationStatus: "best_effort",
      },
    ];

    const { summary } = buildRunDiff([], next, 0.2);

    expect(summary.newAnswers).toBe(2);
    expect(summary.removedAnswers).toBe(0);
    expect(summary.totalCompared).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Phase 83: Bar scaling edge cases (documents expected behavior for Phase 85 UI)
// ---------------------------------------------------------------------------

describe("aggregateQuestionInsights bar scaling edge cases", () => {
  it("all-zero distribution: answered=0, avgConfidence=0, no NaN values", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Paper 1",
        openalexId: "oa:1",
        questionKey: "q1",
        answer: null,
        confidence: 0,
        citationStatus: "insufficient_evidence",
      },
      {
        paperId: "p2",
        title: "Paper 2",
        openalexId: "oa:2",
        questionKey: "q1",
        answer: null,
        confidence: 0,
        citationStatus: "insufficient_evidence",
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "string");

    expect(aggregate.total).toBe(2);
    expect(aggregate.answered).toBe(0);
    // avgConfidence must be a number, not NaN — Phase 85 uses this for bar width calculation
    expect(Number.isNaN(aggregate.avgConfidence)).toBe(false);
    expect(aggregate.avgConfidence).toBe(0);
    expect(aggregate.topAnswers).toEqual([]);
  });

  it("single-dominant value (98%): all 3 answer variants appear in topAnswers with accurate counts", () => {
    const entries: InsightEntry[] = [
      // 98 papers say GPT-4
      ...Array.from({ length: 98 }, (_, i) => ({
        paperId: `p${i}`,
        title: `Paper ${i}`,
        openalexId: `oa:${i}`,
        questionKey: "model",
        answer: "GPT-4",
        confidence: 0.9,
        citationStatus: "grounded" as CitationStatus,
      })),
      // 1 paper says Claude
      {
        paperId: "p98",
        title: "Paper 98",
        openalexId: "oa:98",
        questionKey: "model",
        answer: "Claude",
        confidence: 0.85,
        citationStatus: "grounded" as CitationStatus,
      },
      // 1 paper says Llama
      {
        paperId: "p99",
        title: "Paper 99",
        openalexId: "oa:99",
        questionKey: "model",
        answer: "Llama",
        confidence: 0.8,
        citationStatus: "best_effort" as CitationStatus,
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "string");

    expect(aggregate.total).toBe(100);
    expect(aggregate.answered).toBe(100);

    // All three variants must appear in topAnswers
    // (normalizeAnswer lowercases, so check lowercase)
    const gpt4 = aggregate.topAnswers.find((a) => a.normalized === "gpt-4");
    const claude = aggregate.topAnswers.find((a) => a.normalized === "claude");
    const llama = aggregate.topAnswers.find((a) => a.normalized === "llama");

    expect(gpt4).toBeDefined();
    expect(claude).toBeDefined();
    expect(llama).toBeDefined();

    // Counts must be accurate (minority answers not collapsed to zero)
    expect(gpt4?.count).toBe(98);
    expect(claude?.count).toBe(1);
    expect(llama?.count).toBe(1);
  });

  it("one-answer question (single paper): answered=1, total=1, topAnswers has one entry", () => {
    const entries: InsightEntry[] = [
      {
        paperId: "p1",
        title: "Only Paper",
        openalexId: "oa:1",
        questionKey: "scope",
        answer: "Global",
        confidence: 0.88,
        citationStatus: "grounded",
      },
    ];

    const aggregate = aggregateQuestionInsights(entries, "string");

    expect(aggregate.total).toBe(1);
    expect(aggregate.answered).toBe(1);
    expect(aggregate.topAnswers.length).toBe(1);
    expect(aggregate.topAnswers[0]?.normalized).toBe("global");
    expect(aggregate.topAnswers[0]?.count).toBe(1);
  });
});
