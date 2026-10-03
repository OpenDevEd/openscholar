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
  green: "border-l-4 border-l-success",
  yellow: "border-l-4 border-l-warning",
  red: "border-l-4 border-l-destructive",
};

export const BADGE_COLOR_CLASSES: Record<ThresholdColor, string> = {
  green: "bg-success/10 ink-success border-success/30",
  yellow: "bg-warning/10 ink-warning border-warning/30",
  red: "bg-destructive/10 text-destructive border-destructive/30",
};

export const CARD_TINT_CLASSES: Record<ThresholdColor, string> = {
  green: "bg-success/5",
  yellow: "bg-warning/5",
  red: "bg-destructive/5",
};

export const ICON_COLOR_CLASSES: Record<ThresholdColor, string> = {
  green: "ink-success",
  yellow: "ink-warning",
  red: "text-destructive",
};

/** Confidence distribution bar colors by bucket */
export const CONFIDENCE_BAR_COLORS: Record<string, string> = {
  high: "bg-success",
  medium: "bg-warning",
  low: "bg-destructive",
  unknown: "bg-muted-foreground/60",
};

/** Citation status bar colors — used in stacked bars, mini-bars, and distribution panels */
export const CITATION_BAR_COLORS: Record<string, string> = {
  grounded: "bg-success",
  best_effort: "bg-warning",
  insufficient_evidence: "bg-destructive",
  extraction_error: "bg-muted-foreground/60",
};

/** Format a 0-1 ratio as a rounded percentage string */
export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
