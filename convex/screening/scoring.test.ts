import { describe, it, expect } from "vitest";
import {
  computeScore,
  computeStarRating,
  isQualified,
  outcomeOf,
  scorePaper,
  tallied,
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
  it("returns stars for highest matching minScore (descending sort, first match)", () => {
    const thresholds = [
      { minScore: 0, stars: 1 },
      { minScore: 3, stars: 2 },
      { minScore: 5, stars: 3 },
    ];
    expect(computeStarRating(5, thresholds)).toBe(3); // matches minScore 5
    expect(computeStarRating(4, thresholds)).toBe(2); // matches minScore 3
    expect(computeStarRating(3, thresholds)).toBe(2); // matches minScore 3
    expect(computeStarRating(1, thresholds)).toBe(1); // matches minScore 0
    expect(computeStarRating(0, thresholds)).toBe(1); // matches minScore 0
  });

  it("works regardless of array order (implementation sorts)", () => {
    // Given in ascending order -- implementation should sort descending
    const thresholds = [
      { minScore: 0, stars: 1 },
      { minScore: 3, stars: 2 },
    ];
    expect(computeStarRating(5, thresholds)).toBe(2);
    expect(computeStarRating(0, thresholds)).toBe(1);
    expect(computeStarRating(2, thresholds)).toBe(1);
  });

  it("returns 0 for score below all minScores", () => {
    const thresholds = [{ minScore: 5, stars: 1 }];
    expect(computeStarRating(3, thresholds)).toBe(0);
  });

  it("returns 0 stars for negative score with no negative coverage", () => {
    const thresholds = [
      { minScore: 0, stars: 1 },
      { minScore: 3, stars: 2 },
    ];
    expect(computeStarRating(-5, thresholds)).toBe(0);
  });

  it("handles negative minScore thresholds", () => {
    const thresholds = [
      { minScore: -10, stars: 1 },
      { minScore: 0, stars: 2 },
    ];
    expect(computeStarRating(-5, thresholds)).toBe(1); // matches minScore -10
    expect(computeStarRating(0, thresholds)).toBe(2);  // matches minScore 0
    expect(computeStarRating(5, thresholds)).toBe(2);  // matches minScore 0
  });

  it("clamps stars above 5 to 5", () => {
    const outOfRange = [{ minScore: 0, stars: 7 }];
    expect(computeStarRating(3, outOfRange)).toBe(5);
  });

  it("clamps stars below 0 to 0", () => {
    const negative = [{ minScore: 0, stars: -2 }];
    expect(computeStarRating(3, negative)).toBe(0);
  });

  it("returns 0 stars for empty thresholds", () => {
    expect(computeStarRating(5, [])).toBe(0);
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
      { minScore: -10, stars: 0 },
      { minScore: 0, stars: 1 },
      { minScore: 3, stars: 2 },
      { minScore: 5, stars: 3 },
    ],
    minimumScore: 2,
  };

  it("scores all-yes answers correctly", () => {
    // score = 3+2+1 = 6, highest minScore match: 5 -> stars 3, qualified (6>=2)
    const result = scorePaper({ q1: true, q2: true, q3: true }, config);
    expect(result).toEqual({ score: 6, stars: 3, qualified: true });
  });

  it("scores mixed answers correctly", () => {
    // score = 3+0+(-2) = 1, highest minScore match: 0 -> stars 1, not qualified (1<2)
    const result = scorePaper({ q1: true, q2: false, q3: false }, config);
    expect(result).toEqual({ score: 1, stars: 1, qualified: false });
  });

  it("scores all-null answers correctly", () => {
    // score = 0+(-1)+0 = -1, highest minScore match: -10 -> stars 0, not qualified (-1<2)
    const result = scorePaper({ q1: null, q2: null, q3: null }, config);
    expect(result).toEqual({ score: -1, stars: 0, qualified: false });
  });

  it("treats missing answer key as null (uses nullPoints)", () => {
    // Missing q3 -> nullPoints=0. Score = 3+2+0 = 5, highest minScore match: 5 -> 3 stars, qualified
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
      starThresholds: [{ minScore: 0, stars: 3 }],
    };
    expect(validateScoringConfig(config)).toEqual([]);
  });

  it("warns about star values above 5", () => {
    const config = {
      rules: [],
      starThresholds: [{ minScore: 0, stars: 7 }],
    };
    const warnings = validateScoringConfig(config);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("star_out_of_range");
  });

  it("warns about non-integer star values", () => {
    const config = {
      rules: [],
      starThresholds: [{ minScore: 0, stars: 2.5 }],
    };
    const warnings = validateScoringConfig(config);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].type).toBe("star_out_of_range");
  });

  it("warns about negative star values", () => {
    const config = {
      rules: [],
      starThresholds: [{ minScore: 0, stars: -1 }],
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
      starThresholds: [{ minScore: 0, stars: 2 }],
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
      starThresholds: [{ minScore: -10, stars: 2 }],
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
        { minScore: 0, stars: 7 },
        { minScore: 6, stars: -2 },
      ],
    };
    const warnings = validateScoringConfig(config);
    // star_out_of_range for 7, star_out_of_range for -2, missing_negative_coverage
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});

describe("outcomeOf", () => {
  const config = {
    rules: [{ questionKey: "q1", yesPoints: 2, noPoints: 0, nullPoints: 1 }, { questionKey: "q2", yesPoints: 1, noPoints: 0, nullPoints: 0 }],
    starThresholds: [],
    minimumScore: 2,
  };
  it("includes a paper at the minimum score", () => {
    expect(outcomeOf({ q1: true, q2: false }, config)).toBe("included");
  });
  it("calls a paper unclear when settling its unclear answers the best way would include it", () => {
    expect(outcomeOf({ q1: null, q2: false }, config)).toBe("unclear");
    expect(outcomeOf({ q1: false, q2: null }, config)).toBe("excluded");
  });
  it("excludes a paper no answer of its could lift to the minimum", () => {
    expect(outcomeOf({ q1: false, q2: true }, config)).toBe("excluded");
  });
  it("includes every paper when there's no minimum", () => {
    expect(outcomeOf({ q1: false, q2: false }, { ...config, minimumScore: undefined })).toBe("included");
  });
  it("settles a question with several rules one way for all of them", () => {
    // Yes gives 10 and no gives 10, never both: an unclear answer can't reach 20.
    const rules = [{ questionKey: "q1", yesPoints: 10, noPoints: 0, nullPoints: 0 }, { questionKey: "q1", yesPoints: 0, noPoints: 10, nullPoints: 0 }];
    expect(outcomeOf({ q1: null }, { rules, starThresholds: [], minimumScore: 20 })).toBe("excluded");
    expect(outcomeOf({ q1: null }, { rules, starThresholds: [], minimumScore: 10 })).toBe("unclear");
  });
});

describe("tallied", () => {
  it("adds and takes away a paper's answers, one row a question in the job's order", () => {
    const one = tallied(undefined, ["q1", "q2"], { q1: true, q2: null }, 1);
    expect(one).toEqual([{ key: "q1", yes: 1, no: 0, unclear: 0 }, { key: "q2", yes: 0, no: 0, unclear: 1 }]);
    const two = tallied(one, ["q1", "q2"], { q1: false }, 1);
    expect(two).toEqual([{ key: "q1", yes: 1, no: 1, unclear: 0 }, { key: "q2", yes: 0, no: 0, unclear: 2 }]);
    expect(tallied(two, ["q1", "q2"], { q1: true, q2: null }, -1)).toEqual([{ key: "q1", yes: 0, no: 1, unclear: 0 }, { key: "q2", yes: 0, no: 0, unclear: 1 }]);
  });
});
