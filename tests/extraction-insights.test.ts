import { describe, expect, it } from "vitest";
import {
  aggregateQuestionInsights,
  buildArrayAnswerProfileClusters,
  buildDisagreementClusters,
  buildRunDiff,
} from "../lib/extraction/insights";

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
