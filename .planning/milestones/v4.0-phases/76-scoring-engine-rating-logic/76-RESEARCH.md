# Phase 76: Scoring Engine & Rating Logic - Research

**Researched:** 2026-03-09
**Domain:** Pure-function scoring engine, star rating thresholds, minimum score filtering
**Confidence:** HIGH

## Summary

Phase 76 builds the scoring engine that converts AI screening responses into numerical scores and star ratings. The scope is entirely pure functions (no database mutations, no UI) plus their comprehensive tests. The scoring config schema already exists in `screeningJobs.scoringConfig` (defined in Phase 75) with per-question `yesPoints/noPoints/nullPoints` rules, `starThresholds` array mapping score ranges to 0-5 stars, and an optional `minimumScore` for filtering.

This is a pure computation phase: given a set of AI answers (`Record<string, boolean | null>`) and a scoring config, produce a score, a star rating, and a qualified boolean. No external dependencies, no database operations, no new schema changes. The functions will be consumed by Phase 77's workflow processing when it calls the scoring engine after each paper's AI screening completes.

The key complexity is edge-case handling: negative scores, all-null answers, threshold gaps/overlaps, missing rules for questions, and questions in answers that have no scoring rule. All of these must be handled deterministically with well-defined fallback behavior.

**Primary recommendation:** Create a single `convex/screening/scoring.ts` module with pure functions (`computeScore`, `computeStarRating`, `isQualified`, `scorePaper`) and exhaustive unit tests covering every edge case. No external dependencies needed.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCORE-01 | User can define point values per screening question for each answer (yes/no/null) | Schema already supports this via `scoringConfig.rules[].yesPoints/noPoints/nullPoints` in screeningJobs table (Phase 75). Scoring engine reads these rules to compute per-question contributions. |
| SCORE-02 | System computes a total score per paper based on AI screening responses and user-defined rules | `computeScore(answers, rules)` pure function: iterates over rules, looks up each question's answer in the answers map, adds the corresponding point value, returns total sum. |
| SCORE-03 | User can define star rating thresholds (score ranges that map to 0-5 stars) | Schema already supports this via `scoringConfig.starThresholds[].{minScore, maxScore, stars}`. `computeStarRating(score, thresholds)` finds the matching threshold. |
| SCORE-04 | System maps each paper's total score to a star rating using user-defined thresholds (including edge cases) | `computeStarRating` handles negative scores, gaps in thresholds, and all-null responses. Default to 0 stars when no threshold matches. |
| SCORE-05 | User can set a minimum score threshold -- only papers meeting the threshold are saved to library | `isQualified(score, minimumScore)` returns `score >= minimumScore` when minimumScore is defined, or `true` when undefined (all papers qualify). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (installed) | Test runner for pure function tests | Project standard |
| convex-test | (installed) | Only if integration tests needed (likely not for pure functions) | Project standard for Convex tests |

### Supporting
No additional libraries needed. This phase is entirely pure TypeScript functions with zero dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled scoring | External scoring library | No library needed -- this is simple arithmetic with well-defined rules. A library would add dependency for trivial computation. |
| Separate scoring config table | Embedded config in job record | Already decided in Phase 75: config is embedded in job record as a frozen snapshot. |

## Architecture Patterns

### Recommended Project Structure
```
convex/
  screening/
    scoring.ts              # Pure scoring functions (NEW)
    scoring.test.ts         # Exhaustive unit tests (NEW)
    validators.ts           # Already has scoringConfig validators
    mutations.ts            # Existing (Phase 75)
    queries.ts              # Existing (Phase 75)
```

### Pattern 1: Pure Scoring Function Module
**What:** A module of pure functions with no Convex context dependency, no database access, no side effects. Takes data in, returns computed results.
**When to use:** Always for the scoring engine -- this is the locked decision ("pure-function scoring engine").

```typescript
// convex/screening/scoring.ts

/**
 * Types matching the schema validators (reuse from validators.ts inferred types)
 */
export interface ScoringRule {
  questionKey: string;
  yesPoints: number;
  noPoints: number;
  nullPoints: number;
}

export interface StarThreshold {
  minScore: number;
  maxScore: number;
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

/**
 * Compute total score from AI answers and scoring rules.
 *
 * For each rule, looks up the answer for that question key.
 * - true  -> yesPoints
 * - false -> noPoints
 * - null/undefined/missing -> nullPoints
 *
 * Questions in answers that have NO matching rule are ignored (no contribution).
 * Rules for questions not in answers use nullPoints (treat as unanswered).
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
 * Thresholds use inclusive ranges: minScore <= score <= maxScore.
 * If score falls in no threshold range, returns 0 stars.
 * If score matches multiple overlapping thresholds, the FIRST match wins
 * (thresholds are evaluated in array order).
 */
export function computeStarRating(
  score: number,
  thresholds: StarThreshold[]
): number {
  for (const t of thresholds) {
    if (score >= t.minScore && score <= t.maxScore) {
      return t.stars;
    }
  }
  return 0; // No matching threshold -> 0 stars
}

/**
 * Determine if a paper qualifies based on minimum score.
 * If minimumScore is undefined/null, ALL papers qualify.
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
 * Convenience function composing computeScore + computeStarRating + isQualified.
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
```

### Pattern 2: Threshold Range Design (Inclusive Bounds)
**What:** Star thresholds use `minScore <= score <= maxScore` (both inclusive).
**When to use:** All threshold evaluation.

Key design decisions:
- **Inclusive both ends:** `{ minScore: 0, maxScore: 2, stars: 1 }` means scores 0, 1, and 2 all get 1 star.
- **First-match wins:** If thresholds overlap, the first matching threshold in array order wins. This is simpler than complex priority logic.
- **Gaps produce 0 stars:** If no threshold matches, the paper gets 0 stars. This is the safest default.
- **Stars range:** 0-5 integers, matching the existing `libraryItems.rating` field which accepts `v.number()` in range 0-5.

### Pattern 3: Answer Key Alignment
**What:** The scoring engine uses `questionKey` to match rules to answers.
**When to use:** When the AI screening response arrives.

The existing codebase has two key encoding systems:
1. **Bulk screening (Phase 75):** Questions have a `key` field (e.g., `"q1"`, `"q2"`) set at job creation. Answers are stored as `Record<string, boolean | null>` keyed by these keys.
2. **Client-side screening:** Uses `encodeQuestionKey()` from `lib/ai/core/question-key-codec.ts` which URL-encodes the question text with a `__qk__:` prefix.

For Phase 76, the scoring engine operates on the bulk screening key system (`key` from `screeningQuestionValidator`). The `questionKey` in scoring rules matches the `key` field in questions and the keys in the `answers` record. No codec translation is needed within the scoring engine itself.

### Anti-Patterns to Avoid
- **Coupling to Convex context:** The scoring functions must NOT import from `convex/server` or take `ctx` as a parameter. They are pure functions that can be tested without `convex-test`.
- **Mutating answers:** Do NOT modify the input answers record. Treat all inputs as immutable.
- **Throwing on edge cases:** Do NOT throw errors for missing questions, gaps in thresholds, or negative scores. Handle gracefully with defined fallback behavior (nullPoints for missing answers, 0 stars for no threshold match).
- **Floating-point star ratings:** Stars should be integers 0-5, matching `libraryItems.rating`. The scoring config already constrains `stars` to `v.number()` but the engine should treat them as integers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Score computation | Complex scoring framework | Simple loop over rules with point lookup | The computation is trivial arithmetic; a framework adds complexity for no benefit |
| Config validation | Runtime type checking | Convex validators at schema/mutation level | Phase 75 already validates config shape via `screeningScoringConfigValidator` |

**Key insight:** This is one of the simplest phases in the project. The scoring engine is ~50 lines of pure functions. The real value is in exhaustive edge-case testing, not clever architecture.

## Common Pitfalls

### Pitfall 1: Missing Answer for a Scored Question
**What goes wrong:** A scoring rule references `questionKey: "q3"` but the AI answers only contain `q1` and `q2`. The scoring engine either crashes (KeyError) or silently produces wrong results.
**Why it happens:** AI screening may not return answers for all questions (timeout, API error on specific question, or question not applicable to paper).
**How to avoid:** When a rule's `questionKey` is not found in the answers record, treat it as `null` and use `nullPoints`. This is already handled in the code pattern above (the `else` branch catches `undefined` from missing keys).
**Warning signs:** Papers with fewer answers than questions getting unexpected scores.

### Pitfall 2: Threshold Gaps Causing 0-Star Ratings
**What goes wrong:** User defines thresholds `[{min:1, max:3, stars:1}, {min:5, max:10, stars:2}]`. A paper scores 4. No threshold matches. Paper gets 0 stars.
**Why it happens:** User did not cover score=4 in their thresholds. There is a gap between 3 and 5.
**How to avoid:** The scoring engine correctly returns 0 stars for gaps (safe default). Phase 78 (UI) should optionally warn users about gaps in their threshold configuration. The engine itself should NOT reject configs with gaps -- that is a UI concern.
**Warning signs:** Papers with reasonable scores getting 0 stars.

### Pitfall 3: Negative Scores Not Handled by Thresholds
**What goes wrong:** User defines thresholds starting at `minScore: 0`. Paper with all-no answers scores -9. No threshold covers negative scores. Paper gets 0 stars.
**Why it happens:** Users don't think about negative score scenarios when configuring thresholds.
**How to avoid:** Same as Pitfall 2 -- 0 stars is the safe default. The UI (Phase 78) can suggest adding a threshold for negative scores or show a warning.
**Warning signs:** Many papers getting 0 stars when they should get 1 star.

### Pitfall 4: Overlapping Thresholds Giving Unexpected Stars
**What goes wrong:** User defines `[{min:0, max:5, stars:1}, {min:3, max:8, stars:2}]`. A paper scores 4. First threshold matches -> 1 star. User expected 2 stars because 4 is in the second range too.
**Why it happens:** Overlapping ranges with different star values create ambiguity.
**How to avoid:** First-match-wins is deterministic and documented. The UI (Phase 78) should warn about overlapping thresholds. The engine does NOT reorder or deduplicate -- it evaluates in array order.
**Warning signs:** Users surprised by star ratings on papers in overlapping ranges.

### Pitfall 5: Star Rating Outside 0-5 Range
**What goes wrong:** User configures a threshold with `stars: 7` or `stars: -1`. The library save accepts any number for `rating`.
**Why it happens:** The `starThresholds[].stars` validator is `v.number()` with no range constraint.
**How to avoid:** Clamp the output of `computeStarRating` to 0-5 range. Or better: add validation in the scoring engine that star values must be 0-5 integers. Since the scoring engine is pure, a validation helper function can be provided for Phase 78 to call at config time.
**Warning signs:** Library items with ratings outside 0-5 range.

## Code Examples

### Complete Scoring Flow (end-to-end)
```typescript
// Example: 3 screening questions with scoring rules
const config: ScoringConfig = {
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

// Paper 1: All yes -> 3+2+1 = 6 -> 3 stars -> qualified (6 >= 2)
scorePaper({ q1: true, q2: true, q3: true }, config);
// => { score: 6, stars: 3, qualified: true }

// Paper 2: Mixed -> 3+0+(-2) = 1 -> 1 star -> not qualified (1 < 2)
scorePaper({ q1: true, q2: false, q3: false }, config);
// => { score: 1, stars: 1, qualified: false }

// Paper 3: All null -> 0+(-1)+0 = -1 -> 0 stars -> not qualified (-1 < 2)
scorePaper({ q1: null, q2: null, q3: null }, config);
// => { score: -1, stars: 0, qualified: false }

// Paper 4: Missing q3 (AI didn't answer) -> 3+2+0 = 5 -> 3 stars -> qualified
scorePaper({ q1: true, q2: true }, config);
// => { score: 5, stars: 3, qualified: true }
```

### Config Validation Helper (for Phase 78 UI)
```typescript
// convex/screening/scoring.ts

export interface ConfigValidationWarning {
  type: "gap" | "overlap" | "star_out_of_range" | "missing_negative_coverage";
  message: string;
}

/**
 * Validate scoring config and return warnings (not errors).
 * The scoring engine works with any config, but the UI should warn about
 * potential issues.
 */
export function validateScoringConfig(
  config: ScoringConfig
): ConfigValidationWarning[] {
  const warnings: ConfigValidationWarning[] = [];

  // Check star values in range 0-5
  for (const t of config.starThresholds) {
    if (t.stars < 0 || t.stars > 5 || !Number.isInteger(t.stars)) {
      warnings.push({
        type: "star_out_of_range",
        message: `Star value ${t.stars} is outside 0-5 range`,
      });
    }
  }

  // Check for negative score coverage
  const hasNegativeCoverage = config.starThresholds.some(
    (t) => t.minScore < 0
  );
  const canProduceNegative = config.rules.some(
    (r) => r.yesPoints < 0 || r.noPoints < 0 || r.nullPoints < 0
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
```

### Test Pattern (pure function tests)
```typescript
// convex/screening/scoring.test.ts
// Note: Pure function tests do NOT need convex-test or edge-runtime.
// They run in standard node environment.
import { describe, it, expect } from "vitest";
import {
  computeScore,
  computeStarRating,
  isQualified,
  scorePaper,
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

  it("uses nullPoints for missing answer keys", () => {
    expect(computeScore({}, rules)).toBe(-1); // 0 + (-1)
  });

  it("ignores extra answer keys with no matching rule", () => {
    expect(computeScore({ q1: true, q2: true, q99: false }, rules)).toBe(3);
  });

  it("returns 0 for empty rules", () => {
    expect(computeScore({ q1: true }, [])).toBe(0);
  });

  it("handles mixed answers correctly", () => {
    expect(computeScore({ q1: true, q2: false }, rules)).toBe(2);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No scoring (manual star rating in library) | Computed scoring from AI answers | v4.0 Phase 76 | Papers get automated, consistent ratings based on user-defined rules |
| Client-side screening only (Zustand store) | Server-side bulk with scoring engine | v4.0 Phase 75-76 | Scoring runs server-side for consistency and background processing |

## Open Questions

1. **Should `scoring.test.ts` use edge-runtime or node environment?**
   - What we know: The vitest config maps `convex/**/*.test.ts` to `edge-runtime`. But scoring functions are pure (no Convex context needed).
   - What's unclear: Will vitest pick up the `edge-runtime` environment for `convex/screening/scoring.test.ts` even though the tests don't need convex-test?
   - Recommendation: Accept edge-runtime for consistency with the glob pattern. Pure functions work fine in edge-runtime. No special configuration needed.

2. **Should the scoring engine clamp stars to 0-5 or trust the config?**
   - What we know: `libraryItems.rating` is `v.number()` with no range constraint in schema, but the UI renders 0-5 stars.
   - What's unclear: Whether to enforce clamping in the engine or leave it to the caller.
   - Recommendation: Clamp to 0-5 in `computeStarRating` as a safety net. The validation helper warns about out-of-range configs, but the engine is defensive. Use `Math.max(0, Math.min(5, stars))` on the threshold's star value.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (pure function tests, no convex-test needed) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run convex/screening/scoring.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCORE-01 | Point values per question for yes/no/null are read from rules | unit | `npx vitest run convex/screening/scoring.test.ts -t "computeScore"` | Wave 0 |
| SCORE-02 | Total score computed by summing per-question points | unit | `npx vitest run convex/screening/scoring.test.ts -t "computeScore"` | Wave 0 |
| SCORE-02 | Edge: missing answers use nullPoints | unit | `npx vitest run convex/screening/scoring.test.ts -t "missing"` | Wave 0 |
| SCORE-02 | Edge: extra answer keys ignored | unit | `npx vitest run convex/screening/scoring.test.ts -t "extra"` | Wave 0 |
| SCORE-02 | Edge: empty rules produces score 0 | unit | `npx vitest run convex/screening/scoring.test.ts -t "empty rules"` | Wave 0 |
| SCORE-02 | Edge: all-null answers | unit | `npx vitest run convex/screening/scoring.test.ts -t "all.*null"` | Wave 0 |
| SCORE-02 | Edge: negative scores from negative point values | unit | `npx vitest run convex/screening/scoring.test.ts -t "negative"` | Wave 0 |
| SCORE-03 | Star thresholds map score ranges to 0-5 stars | unit | `npx vitest run convex/screening/scoring.test.ts -t "computeStarRating"` | Wave 0 |
| SCORE-04 | Score mapped to stars using thresholds (inclusive bounds) | unit | `npx vitest run convex/screening/scoring.test.ts -t "computeStarRating"` | Wave 0 |
| SCORE-04 | Edge: score in threshold gap returns 0 stars | unit | `npx vitest run convex/screening/scoring.test.ts -t "gap"` | Wave 0 |
| SCORE-04 | Edge: negative score with no coverage returns 0 stars | unit | `npx vitest run convex/screening/scoring.test.ts -t "negative.*score"` | Wave 0 |
| SCORE-04 | Edge: overlapping thresholds use first match | unit | `npx vitest run convex/screening/scoring.test.ts -t "overlap"` | Wave 0 |
| SCORE-04 | Edge: stars clamped to 0-5 range | unit | `npx vitest run convex/screening/scoring.test.ts -t "clamp"` | Wave 0 |
| SCORE-05 | Papers below minimum score are not qualified | unit | `npx vitest run convex/screening/scoring.test.ts -t "isQualified"` | Wave 0 |
| SCORE-05 | Undefined minimumScore means all papers qualify | unit | `npx vitest run convex/screening/scoring.test.ts -t "undefined.*minimum"` | Wave 0 |
| SCORE-05 | Score exactly equal to minimumScore qualifies | unit | `npx vitest run convex/screening/scoring.test.ts -t "equal.*minimum"` | Wave 0 |
| ALL | End-to-end scorePaper composes all three functions | unit | `npx vitest run convex/screening/scoring.test.ts -t "scorePaper"` | Wave 0 |
| ALL | Config validation warns about gaps/overlaps/out-of-range | unit | `npx vitest run convex/screening/scoring.test.ts -t "validateScoringConfig"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/screening/scoring.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `convex/screening/scoring.ts` -- pure scoring functions (does not exist yet)
- [ ] `convex/screening/scoring.test.ts` -- exhaustive unit tests (does not exist yet)

## Sources

### Primary (HIGH confidence)
- `convex/screening/validators.ts` -- existing scoring config validators (`screeningScoringRuleValidator`, `screeningScoringConfigValidator`)
- `convex/screening/mutations.ts` -- how scoring config is stored in job records
- `convex/schema.ts:684-770` -- screeningJobs and screeningResults schema with embedded scoring config
- `convex/library/mutations.ts:39+` -- saveToLibrary accepts `rating: v.number()` (0-5 range)
- `.planning/research/PITFALLS_v4.0_BULK_SCREENING.md` -- Pitfalls 5 (null handling) and 6 (threshold gaps) directly apply
- `lib/ai/core/question-key-codec.ts` -- question key encoding (not needed in scoring engine, but relevant context for key alignment)

### Secondary (MEDIUM confidence)
- `.planning/phases/75-schema-job-infrastructure/75-RESEARCH.md` -- Phase 75 research establishing the scoring config schema design
- `.planning/phases/75-schema-job-infrastructure/75-CONTEXT.md` -- locked decisions about scoring config embedding

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no external dependencies, pure TypeScript functions
- Architecture: HIGH -- straightforward pure function module, pattern is well-established
- Pitfalls: HIGH -- edge cases identified from schema analysis and pitfalls research doc
- Test coverage: HIGH -- all behaviors map to simple unit tests on pure functions

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- internal pure functions, no external dependency changes)
