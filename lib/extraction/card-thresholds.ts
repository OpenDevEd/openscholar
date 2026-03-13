// Threshold-based color mapping for summary cards and confidence badge.
// Single source of truth — never re-implement these in components.

export type ThresholdColor = "green" | "yellow" | "red";

export const CONFIDENCE_THRESHOLDS = {
  green: 0.85,
  yellow: 0.60,
} as const;

// Card thresholds by metric type
export const CARD_THRESHOLDS = {
  completion: { green: 0.75, yellow: 0.50 }, // answered rate
  quality: { green: 0.70, yellow: 0.50 },    // grounded rate
} as const;

export function getConfidenceColor(value: number): ThresholdColor {
  if (value >= CONFIDENCE_THRESHOLDS.green) return "green";
  if (value >= CONFIDENCE_THRESHOLDS.yellow) return "yellow";
  return "red";
}

export function getCardColor(
  metricType: keyof typeof CARD_THRESHOLDS,
  value: number
): ThresholdColor {
  const thresholds = CARD_THRESHOLDS[metricType];
  if (value >= thresholds.green) return "green";
  if (value >= thresholds.yellow) return "yellow";
  return "red";
}

// Tailwind class maps — dark mode aware
export const BORDER_COLOR_CLASSES: Record<ThresholdColor, string> = {
  green: "border-l-4 border-l-emerald-500 dark:border-l-emerald-400",
  yellow: "border-l-4 border-l-amber-500 dark:border-l-amber-400",
  red: "border-l-4 border-l-red-500 dark:border-l-red-400",
};

export const BADGE_COLOR_CLASSES: Record<ThresholdColor, string> = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800",
  yellow: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-400 dark:border-red-800",
};

export const CARD_TINT_CLASSES: Record<ThresholdColor, string> = {
  green: "bg-emerald-50/40 dark:bg-emerald-950/20",
  yellow: "bg-amber-50/40 dark:bg-amber-950/20",
  red: "bg-red-50/40 dark:bg-red-950/20",
};

export const ICON_COLOR_CLASSES: Record<ThresholdColor, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  yellow: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
};

/** Confidence distribution bar colors by bucket */
export const CONFIDENCE_BAR_COLORS: Record<string, string> = {
  high: "bg-emerald-500 dark:bg-emerald-400",
  medium: "bg-amber-500 dark:bg-amber-400",
  low: "bg-red-500 dark:bg-red-400",
  unknown: "bg-gray-400 dark:bg-gray-500",
};

/** Citation status bar colors — used in stacked bars, mini-bars, and distribution panels */
export const CITATION_BAR_COLORS: Record<string, string> = {
  grounded: "bg-emerald-500 dark:bg-emerald-400",
  best_effort: "bg-amber-500 dark:bg-amber-400",
  insufficient_evidence: "bg-red-500 dark:bg-red-400",
  extraction_error: "bg-gray-400 dark:bg-gray-500",
};

/** Format a 0-1 ratio as a rounded percentage string */
export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
