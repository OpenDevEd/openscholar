export function requireExtractionEnabled(): void {
  if (process.env.NEXT_PUBLIC_EXTRACTION_ENABLED === "false") {
    throw new Error("Extraction feature is disabled");
  }
}
