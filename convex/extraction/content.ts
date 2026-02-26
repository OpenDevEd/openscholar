export const MIN_ABSTRACT_LENGTH = 50;

export function isPdfExtractionEnabled() {
  return process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED !== "false";
}

export function getProcessableFlags(args: {
  pdfUrl?: string | null;
  storageId?: string | null;
  abstract?: string | null;
  pdfEnabled?: boolean;
}) {
  const pdfEnabled = args.pdfEnabled ?? isPdfExtractionEnabled();
  const hasPdfUrl =
    pdfEnabled && (!!args.pdfUrl || !!args.storageId);
  const hasAbstract = !!args.abstract && args.abstract.length > MIN_ABSTRACT_LENGTH;
  return {
    hasPdfUrl,
    hasAbstract,
    processable: hasPdfUrl || hasAbstract,
  };
}
