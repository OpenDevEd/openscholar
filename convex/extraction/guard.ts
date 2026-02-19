export function requireExtractionEnabled(): void {
  if (process.env.EXTRACTION_ENABLED === "false") {
    throw new Error("Extraction feature is disabled");
  }
}
