export const extractionFeatureFlags = {
  enabled: process.env.NEXT_PUBLIC_EXTRACTION_ENABLED !== "false",
  pdf: process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED !== "false",
  insights: process.env.NEXT_PUBLIC_EXTRACTION_INSIGHTS !== "false",
  reviewQueue: false,
  reportBuilder: false,
};
