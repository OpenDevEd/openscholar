export const extractionFeatureFlags = {
  enabled: process.env.NEXT_PUBLIC_EXTRACTION_ENABLED !== "false",
  pdf: process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED !== "false",
  insights: process.env.NEXT_PUBLIC_EXTRACTION_INSIGHTS !== "false",
  reviewQueue: process.env.NEXT_PUBLIC_EXTRACTION_REVIEW_QUEUE !== "false",
  reportBuilder: process.env.NEXT_PUBLIC_EXTRACTION_REPORT_BUILDER !== "false",
};
