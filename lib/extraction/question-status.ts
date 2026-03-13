/**
 * Question completion status utilities for the question list progress bars (QLIST-01, QLIST-02).
 *
 * Colors match CITATION_STATUS_COLORS from bar-scaling.ts to prevent color drift.
 * All functions are pure — no React imports, no side effects.
 */

export type QuestionStatus = 'complete' | 'partial' | 'empty';

/**
 * Determines question completion status based on answered/total ratio.
 * - complete: answered === total AND total > 0
 * - partial: answered > 0 AND answered < total
 * - empty: answered === 0 OR total === 0
 */
export function statusFromCompletion(answered: number, total: number): QuestionStatus {
  if (total === 0) return 'empty';
  if (answered === total) return 'complete';
  if (answered > 0) return 'partial';
  return 'empty';
}

/**
 * Calculates percentage of papers answered, always returning a finite number.
 * Guards against division by zero. Returns 0 when total is 0.
 */
export function getAnswerPercentage(answered: number, total: number): number {
  return Math.round((answered / Math.max(total, 1)) * 100);
}

/** Tailwind class map for status dots — dark mode aware */
export const STATUS_DOT_CLASSES: Record<QuestionStatus, string> = {
  complete: "bg-emerald-500 dark:bg-emerald-400",
  partial: "bg-amber-500 dark:bg-amber-400",
  empty: "bg-gray-300 dark:bg-gray-600",
} as const;

/**
 * i18n key map for status dot aria-labels and tooltips.
 * Keys seeded in all 6 locale files during Phase 83.
 */
export const STATUS_DOT_LABELS: Record<QuestionStatus, string> = {
  complete: 'statusDotComplete',
  partial: 'statusDotPartial',
  empty: 'statusDotEmpty',
} as const;
