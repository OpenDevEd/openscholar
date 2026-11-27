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
  /** A paper not answered yes here is never included, whatever its points. */
  required?: boolean;
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
  // Short of a required yes, the paper keeps its score but gets no stars and isn't included.
  if (missesRequired(answers, config.rules)) return { score, stars: 0, qualified: false };
  const stars = computeStarRating(score, config.starThresholds);
  const qualified = isQualified(score, config.minimumScore);
  return { score, stars, qualified };
}

/** Whether a required question wasn't answered yes. */
function missesRequired(answers: Record<string, boolean | null>, rules: ScoringRule[]) {
  return rules.some((rule) => rule.required && answers[rule.questionKey] !== true);
}

/** Where a screened paper lands. A paper the model couldn't read is `failed`, which no score decides. */
export type ScoredOutcome = "included" | "unclear" | "excluded";

/**
 * Excluded when a required question is answered no. Included at the minimum score with every
 * required question answered yes. Unclear when it's under it but its unclear answers,
 * settled the best way the rules allow, would take it there: those are the papers worth a
 * second look. Excluded otherwise.
 */
export function outcomeOf(answers: Record<string, boolean | null>, config: ScoringConfig): ScoredOutcome {
  const required = new Set(config.rules.filter((rule) => rule.required).map((rule) => rule.questionKey));
  if ([...required].some((key) => answers[key] === false)) return "excluded";
  if (!missesRequired(answers, config.rules) && isQualified(computeScore(answers, config.rules), config.minimumScore)) return "included";
  // A question with several rules settles one way for all of them; a required one, only as yes.
  const best = [...new Set(config.rules.map((rule) => rule.questionKey))].reduce((sum, key) => {
    const points = (field: "yesPoints" | "noPoints" | "nullPoints") => config.rules.reduce((total, rule) => total + (rule.questionKey === key ? rule[field] : 0), 0);
    const answer = answers[key];
    return sum + (answer === true || (answer !== false && required.has(key)) ? points("yesPoints") : answer === false ? points("noPoints") : Math.max(points("yesPoints"), points("noPoints"), points("nullPoints")));
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

