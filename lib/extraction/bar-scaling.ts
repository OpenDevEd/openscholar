/**
 * Bar scaling utilities for the bar visualization feature (BAR-01).
 *
 * Pure TypeScript — no React imports. All functions are side-effect-free.
 */

/** Centralized hex colors for citation status, shared with Phase 84 confidence badge.
 *  These match BADGE_COLOR_CLASSES in card-thresholds.ts to prevent color drift. */
export const CITATION_STATUS_COLORS: Record<string, string> = {
  grounded: "#10b981",
  best_effort: "#f59e0b",
  insufficient_evidence: "#ef4444",
  extraction_error: "#6b7280",
} as const;

/**
 * Normalizes an array of counts so the maximum value maps to 1.0 and all
 * others map to proportional fractions.
 *
 * Guards:
 *  - Non-finite values (NaN, Infinity) are treated as 0.
 *  - All-zero or empty input never produces NaN output.
 *  - Division uses Math.max(...safeValues, 1) so max is at least 1.
 */
export function normalizeToMax(values: number[]): number[] {
  if (values.length === 0) return [];

  const safe = values.map(v => (Number.isFinite(v) ? v : 0));
  const max = Math.max(...safe, 1);

  return safe.map(v => v / max);
}

export interface ScaledAnswer {
  answer: string;
  count: number;
  scaledWidth: number;
  percentage: number;
}

/**
 * Enriches each answer item with `scaledWidth` (0–1) and `percentage` (0–100,
 * rounded) values suitable for bar display.
 *
 * - `scaledWidth` is computed relative to the maximum count (like normalizeToMax).
 * - `percentage` is relative to the total count.
 * - All-zero counts produce scaledWidth=0 and percentage=0 with no NaN.
 * - Raw `count` is preserved on every item for tooltip display.
 */
export function scaleAnswersForDisplay(
  answers: Array<{ answer: string; count: number }>
): ScaledAnswer[] {
  if (answers.length === 0) return [];

  const counts = answers.map(a => a.count);
  const max = Math.max(...counts, 1);
  const total = counts.reduce((sum, c) => sum + c, 0);
  const safeTotalDivisor = total === 0 ? 1 : total;

  return answers.map(a => ({
    answer: a.answer,
    count: a.count,
    scaledWidth: a.count / max,
    percentage: Math.round((a.count / safeTotalDivisor) * 100),
  }));
}
