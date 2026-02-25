export function getStatusFilterOptionIds(pdfEnabled: boolean): string[] {
  const baseOptions = [
    "abstract-only",
    "open-access",
    "has-errors",
    "high-confidence",
    "low-confidence",
    "reviewed",
    "needs-followup",
  ];
  return pdfEnabled ? ["has-pdf", ...baseOptions] : baseOptions;
}
