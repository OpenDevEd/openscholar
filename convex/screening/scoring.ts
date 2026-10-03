/**
 * Pure scoring engine for bulk screening.
 *
 * Converts AI screening responses into numerical scores, star ratings,
 * and qualification decisions. Zero Convex dependencies -- these are
 * pure functions consumed by the screening pipeline.
 */

// ---------------------------------------------------------------------------
// Types (aligned with validator shapes in validators.ts)
// ---------------------------------------------------------------------------

export interface ScoringRule {
  questionKey: string;
  yesPoints: number;
  noPoints: number;
  nullPoints: number;
}

export interface StarThreshold {
  minScore: number;
  stars: number;
}

export interface ScoringConfig {
  rules: ScoringRule[];
  starThresholds: StarThreshold[];
  minimumScore?: number;
}

export interface ScoringResult {
  score: number;
  stars: number;
  qualified: boolean;
}

export interface ConfigValidationWarning {
  type: "star_out_of_range" | "missing_negative_coverage";
  message: string;
}

// ---------------------------------------------------------------------------
// Core scoring functions
// ---------------------------------------------------------------------------

/**
 * Compute total score from AI answers and scoring rules.
 *
 * For each rule, looks up the answer for that question key:
 * - true  -> yesPoints
 * - false -> noPoints
 * - null/undefined/missing -> nullPoints
 *
 * Questions in answers with no matching rule are ignored.
 * Rules for questions not in answers use nullPoints.
 */
export function computeScore(
  answers: Record<string, boolean | null>,
  rules: ScoringRule[]
): number {
  let total = 0;
  for (const rule of rules) {
    const answer = answers[rule.questionKey];
    if (answer === true) {
      total += rule.yesPoints;
    } else if (answer === false) {
      total += rule.noPoints;
    } else {
      // null, undefined, or missing key
      total += rule.nullPoints;
    }
  }
  return total;
}

/**
 * Map a total score to a star rating using user-defined thresholds.
 *
 * Thresholds sorted by minScore descending, first match wins.
 * A threshold matches when score >= t.minScore.
 * Returns 0 if no threshold matches.
 * Clamps result to 0-5 range.
 */
export function computeStarRating(
  score: number,
  thresholds: StarThreshold[]
): number {
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  for (const t of sorted) {
    if (score >= t.minScore) {
      return Math.max(0, Math.min(5, t.stars));
    }
  }
  return 0;
}

/**
 * Determine if a paper qualifies based on minimum score.
 * If minimumScore is undefined, ALL papers qualify.
 */
export function isQualified(
  score: number,
  minimumScore: number | undefined
): boolean {
  if (minimumScore === undefined || minimumScore === null) {
    return true;
  }
  return score >= minimumScore;
}

/**
 * Score a single paper end-to-end.
 * Composes computeScore + computeStarRating + isQualified.
 */
export function scorePaper(
  answers: Record<string, boolean | null>,
  config: ScoringConfig
): ScoringResult {
  const score = computeScore(answers, config.rules);
  const stars = computeStarRating(score, config.starThresholds);
  const qualified = isQualified(score, config.minimumScore);
  return { score, stars, qualified };
}

/** Where a screened paper lands. A paper the model couldn't read is `failed`, which no score decides. */
export type ScoredOutcome = "included" | "unclear" | "excluded";

/**
 * Included at the minimum score. Unclear when it's under it but its unclear answers,
 * settled the best way the rules allow, would take it there: those are the papers worth a
 * second look. Excluded otherwise.
 */
export function outcomeOf(answers: Record<string, boolean | null>, config: ScoringConfig): ScoredOutcome {
  if (isQualified(computeScore(answers, config.rules), config.minimumScore)) return "included";
  // A question with several rules settles one way for all of them.
  const best = [...new Set(config.rules.map((rule) => rule.questionKey))].reduce((sum, key) => {
    const points = (field: "yesPoints" | "noPoints" | "nullPoints") => config.rules.reduce((total, rule) => total + (rule.questionKey === key ? rule[field] : 0), 0);
    const answer = answers[key];
    return sum + (answer === true ? points("yesPoints") : answer === false ? points("noPoints") : Math.max(points("yesPoints"), points("noPoints"), points("nullPoints")));
  }, 0);
  return isQualified(best, config.minimumScore) ? "unclear" : "excluded";
}

/** How a question's answers split across a job's papers. */
export type QuestionTally = { key: string; yes: number; no: number; unclear: number };

/** `tallies` with one paper's answers added (`by` 1) or taken away (`by` -1), a row per question in `keys`' order. */
export function tallied(tallies: QuestionTally[] | undefined, keys: string[], answers: Record<string, boolean | null>, by: 1 | -1): QuestionTally[] {
  const known = new Map((tallies ?? []).map((tally) => [tally.key, tally] as const));
  return keys.map((key) => {
    const tally = known.get(key) ?? { key, yes: 0, no: 0, unclear: 0 };
    const answer = answers[key];
    const field = answer === true ? "yes" : answer === false ? "no" : "unclear";
    return { ...tally, [field]: Math.max(0, tally[field] + by) };
  });
}

// ---------------------------------------------------------------------------
// Config validation (warnings, not errors -- engine works with any config)
// ---------------------------------------------------------------------------

/**
 * Validate scoring config and return warnings.
 * The scoring engine works with any config, but the UI should warn about
 * potential issues like out-of-range stars or missing negative coverage.
 */
export function validateScoringConfig(
  config: ScoringConfig
): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];

  // Check star values in 0-5 integer range
  for (const t of config.starThresholds) {
    if (t.stars < 0 || t.stars > 5 || !Number.isInteger(t.stars)) {
      warnings.push({
        type: "star_out_of_range",
        message: `Star value ${t.stars} is outside valid 0-5 integer range`,
      });
    }
  }

  // Check for negative score coverage when rules can produce negatives
  const canProduceNegative = config.rules.some(
    (r) => r.yesPoints < 0 || r.noPoints < 0 || r.nullPoints < 0
  );
  const hasNegativeCoverage = config.starThresholds.some(
    (t) => t.minScore < 0
  );
  if (canProduceNegative && !hasNegativeCoverage) {
    warnings.push({
      type: "missing_negative_coverage",
      message:
        "Scoring rules can produce negative scores but no threshold covers negative values",
    });
  }

  return warnings;
}
