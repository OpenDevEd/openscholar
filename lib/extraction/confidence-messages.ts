// Maps citation status composition to the correct i18n tooltip key for the confidence badge.
// Pure function — no React dependency. Keys correspond to messages/*.json extraction namespace.

export type ConfidenceTooltipKey =
  | "confidenceAbstractOnly"
  | "confidenceNoContent"
  | "confidence";

export function getConfidenceTooltipKey(
  abstractOnlyCount: number,
  noContentCount: number,
  totalPapers: number
): ConfidenceTooltipKey {
  // No content for all papers → explain missing evidence
  if (totalPapers > 0 && noContentCount === totalPapers) {
    return "confidenceNoContent";
  }

  // All papers abstract-only → explain the 70% cap
  if (totalPapers > 0 && abstractOnlyCount === totalPapers) {
    return "confidenceAbstractOnly";
  }

  // Mixed: some abstract-only → still warn about the cap affecting the subset
  if (abstractOnlyCount > 0) {
    return "confidenceAbstractOnly";
  }

  // All full-text, all errors, or zero papers — no special context needed
  return "confidence";
}
