export function getStatusFilterOptionIds(pdfEnabled: boolean): string[] {
  const baseOptions = [
    "abstract-only",
    "open-access",
    "has-errors",
    "high-confidence",
    "low-confidence",
  ];
  return pdfEnabled ? ["has-pdf", ...baseOptions] : baseOptions;
}
