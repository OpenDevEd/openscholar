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

// Tailwind class maps for consistent visual output
export const BORDER_COLOR_CLASSES: Record<ThresholdColor, string> = {
  green: "border-l-4 border-green-400",
  yellow: "border-l-4 border-yellow-400",
  red: "border-l-4 border-red-400",
};

export const BADGE_COLOR_CLASSES: Record<ThresholdColor, string> = {
  green: "bg-green-100 text-green-900 border-green-200",
  yellow: "bg-yellow-100 text-yellow-900 border-yellow-200",
  red: "bg-red-100 text-red-900 border-red-200",
};
