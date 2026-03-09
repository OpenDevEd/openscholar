import { describe, it, expect } from "vitest";
import {
  computeScore,
  computeStarRating,
  isQualified,
  scorePaper,
  validateScoringConfig,
} from "./scoring";

describe("computeScore", () => {
  const rules = [
    { questionKey: "q1", yesPoints: 2, noPoints: -1, nullPoints: 0 },
    { questionKey: "q2", yesPoints: 1, noPoints: 0, nullPoints: -1 },
  ];

  it("sums yes points for all-yes answers", () => {
    expect(computeScore({ q1: true, q2: true }, rules)).toBe(3);
  });

  it("sums no points for all-no answers", () => {
    expect(computeScore({ q1: false, q2: false }, rules)).toBe(-1);
  });

  it("uses nullPoints for null answers", () => {
    expect(computeScore({ q1: null, q2: null }, rules)).toBe(-1);
  });

  it("uses nullPoints for missing answer keys (empty answers)", () => {
    expect(computeScore({}, rules)).toBe(-1); // 0 + (-1)
  });

  it("ignores extra answer keys with no matching rule", () => {
    expect(computeScore({ q1: true, q2: true, q99: false }, rules)).toBe(3);
  });

  it("returns 0 for empty rules", () => {
    expect(computeScore({ q1: true }, [])).toBe(0);
  });

  it("handles mixed answers correctly", () => {
    expect(computeScore({ q1: true, q2: false }, rules)).toBe(2); // 2 + 0
  });

  it("handles single rule with all answer types", () => {
    const singleRule = [
      { questionKey: "q1", yesPoints: 5, noPoints: -3, nullPoints: 1 },
    ];
    expect(computeScore({ q1: true }, singleRule)).toBe(5);
    expect(computeScore({ q1: false }, singleRule)).toBe(-3);
    expect(computeScore({ q1: null }, singleRule)).toBe(1);
  });
});

describe("computeStarRating", () => {
  const thresholds = [
    { minScore: 0, maxScore: 2, stars: 1 },
    { minScore: 3, maxScore: 5, stars: 2 },
  ];

  it("returns correct stars for score in second threshold", () => {
    expect(computeStarRating(5, thresholds)).toBe(2);
  });

  it("returns correct stars for score in first threshold", () => {
    expect(computeStarRating(0, thresholds)).toBe(1);
  });

  it("returns 0 stars for score in gap between thresholds", () => {
    const gappedThresholds = [
      { minScore: 0, maxScore: 3, stars: 1 },
      { minScore: 5, maxScore: 10, stars: 2 },
    ];
    expect(computeStarRating(4, gappedThresholds)).toBe(0);
  });

  it("returns 0 stars for negative score with no negative coverage", () => {
    expect(computeStarRating(-5, thresholds)).toBe(0);
  });

  it("uses first match for overlapping thresholds", () => {
    const overlapping = [
      { minScore: 0, maxScore: 5, stars: 1 },
      { minScore: 3, maxScore: 8, stars: 2 },
    ];
    expect(computeStarRating(4, overlapping)).toBe(1); // first match wins
  });

  it("clamps stars above 5 to 5", () => {
    const outOfRange = [{ minScore: 0, maxScore: 10, stars: 7 }];
    expect(computeStarRating(3, outOfRange)).toBe(5);
  });

  it("clamps stars below 0 to 0", () => {
    const negative = [{ minScore: 0, maxScore: 10, stars: -2 }];
    expect(computeStarRating(3, negative)).toBe(0);
  });

  it("returns 0 stars for empty thresholds", () => {
    expect(computeStarRating(5, [])).toBe(0);
  });

  it("handles score at exact threshold boundary (inclusive)", () => {
    expect(computeStarRating(2, thresholds)).toBe(1); // maxScore inclusive
    expect(computeStarRating(3, thresholds)).toBe(2); // minScore inclusive
  });
});

describe("isQualified", () => {
  it("returns true when score >= minimumScore", () => {
    expect(isQualified(5, 3)).toBe(true);
  });

  it("returns false when score < minimumScore", () => {
    expect(isQualified(2, 3)).toBe(false);
  });

  it("returns true when score equals minimumScore", () => {
    expect(isQualified(3, 3)).toBe(true);
  });

  it("returns true when minimumScore is undefined (all qualify)", () => {
    expect(isQualified(5, undefined)).toBe(true);
  });

  it("returns true for negative score when minimumScore is undefined", () => {
    expect(isQualified(-10, undefined)).toBe(true);
  });

  it("returns false for negative score below minimumScore", () => {
    expect(isQualified(-5, 0)).toBe(false);
  });

  it("returns true for zero score with zero minimumScore", () => {
    expect(isQualified(0, 0)).toBe(true);
  });
});

describe("scorePaper", () => {
  const config = {
    rules: [
      { questionKey: "q1", yesPoints: 3, noPoints: -1, nullPoints: 0 },
      { questionKey: "q2", yesPoints: 2, noPoints: 0, nullPoints: -1 },
      { questionKey: "q3", yesPoints: 1, noPoints: -2, nullPoints: 0 },
    ],
    starThresholds: [
      { minScore: -10, maxScore: -1, stars: 0 },
      { minScore: 0, maxScore: 2, stars: 1 },
      { minScore: 3, maxScore: 4, stars: 2 },
      { minScore: 5, maxScore: 6, stars: 3 },
    ],
    minimumScore: 2,
  };

  it("scores all-yes answers correctly", () => {
    const result = scorePaper({ q1: true, q2: true, q3: true }, config);
    expect(result).toEqual({ score: 6, stars: 3, qualified: true });
  });

  it("scores mixed answers correctly", () => {
    const result = scorePaper({ q1: true, q2: false, q3: false }, config);
    expect(result).toEqual({ score: 1, stars: 1, qualified: false });
  });

  it("scores all-null answers correctly", () => {
    const result = scorePaper({ q1: null, q2: null, q3: null }, config);
    expect(result).toEqual({ score: -1, stars: 0, qualified: false });
  });

  it("treats missing answer key as null (uses nullPoints)", () => {
    // Missing q3 -> nullPoints=0. Score = 3+2+0 = 5 -> 3 stars -> qualified
    const result = scorePaper({ q1: true, q2: true }, config);
    expect(result).toEqual({ score: 5, stars: 3, qualified: true });
  });

  it("handles config without minimumScore (all qualify)", () => {
    const noMinConfig = { ...config, minimumScore: undefined };
    const result = scorePaper(
      { q1: false, q2: false, q3: false },
      noMinConfig
    );
    expect(result.qualified).toBe(true);
  });
});

describe("validateScoringConfig", () => {
  it("returns empty warnings for valid config", () => {
    const config = {
      rules: [{ questionKey: "q1", yesPoints: 2, noPoints: 0, nullPoints: 0 }],
      starThresholds: [{ minScore: 0, maxScore: 10, stars: 3 }],
    };
    expect(validateScoringConfig(config)).toEqual([]);
  });

  it("warns about star values above 5", () => {
    const config = {
      rules: [],
      starThresholds: [{ minScore: 0, maxScore: 10, stars: 7 }],
    };
    const warnings = validateScoringConfig(config);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("star_out_of_range");
  });

  it("warns about non-integer star values", () => {
    const config = {
      rules: [],
      starThresholds: [{ minScore: 0, maxScore: 10, stars: 2.5 }],
    };
    const warnings = validateScoringConfig(config);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("star_out_of_range");
  });

  it("warns about negative star values", () => {
    const config = {
      rules: [],
      starThresholds: [{ minScore: 0, maxScore: 10, stars: -1 }],
    };
    const warnings = validateScoringConfig(config);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("star_out_of_range");
  });

  it("warns about missing negative coverage when rules can produce negative scores", () => {
    const config = {
      rules: [
        { questionKey: "q1", yesPoints: 2, noPoints: -3, nullPoints: 0 },
      ],
      starThresholds: [{ minScore: 0, maxScore: 10, stars: 2 }],
    };
    const warnings = validateScoringConfig(config);
    expect(warnings.some((w) => w.type === "missing_negative_coverage")).toBe(
      true
    );
  });

  it("does not warn about negative coverage when thresholds cover negatives", () => {
    const config = {
      rules: [
        { questionKey: "q1", yesPoints: 2, noPoints: -3, nullPoints: 0 },
      ],
      starThresholds: [{ minScore: -10, maxScore: 10, stars: 2 }],
    };
    const warnings = validateScoringConfig(config);
    expect(warnings.some((w) => w.type === "missing_negative_coverage")).toBe(
      false
    );
  });

  it("returns multiple warnings when config has multiple issues", () => {
    const config = {
      rules: [
        { questionKey: "q1", yesPoints: 2, noPoints: -1, nullPoints: 0 },
      ],
      starThresholds: [
        { minScore: 0, maxScore: 5, stars: 7 },
        { minScore: 6, maxScore: 10, stars: -2 },
      ],
    };
    const warnings = validateScoringConfig(config);
    // star_out_of_range for 7, star_out_of_range for -2, missing_negative_coverage
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});
