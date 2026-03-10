/**
 * Bar data validation utilities (BAR-03).
 *
 * Pure TypeScript — no React imports. All functions are side-effect-free.
 */

export interface SafeBarData {
  isEmpty: boolean;
  max: number;
  items: Array<{
    answer: string;
    count: number;
    percentage: number;
  }>;
}

/**
 * Validates and normalizes raw answer data for bar display.
 *
 * Guards:
 *  - null/undefined input → isEmpty=true, max=0, items=[]
 *  - Empty array → isEmpty=true
 *  - NaN and negative counts are filtered out before any calculations
 *  - All counts zero (after filtering) → isEmpty=true
 *  - percentages are computed as count / total * 100 (rounded), no NaN output
 */
export function validateBarData(
  data: Array<{ answer: string; count: number }> | null | undefined
): SafeBarData {
  const empty: SafeBarData = { isEmpty: true, max: 0, items: [] };

  if (!data || data.length === 0) return empty;

  // Filter out invalid counts (NaN, negative)
  const valid = data.filter(
    item => Number.isFinite(item.count) && item.count >= 0
  );

  if (valid.length === 0) return empty;

  const total = valid.reduce((sum, item) => sum + item.count, 0);

  if (total === 0) return empty;

  const max = Math.max(...valid.map(item => item.count));
  const safeTotalDivisor = total === 0 ? 1 : total;

  const items = valid.map(item => ({
    answer: item.answer,
    count: item.count,
    percentage: Math.round((item.count / safeTotalDivisor) * 100),
  }));

  return { isEmpty: false, max, items };
}
