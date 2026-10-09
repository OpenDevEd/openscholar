export const MIN_ABSTRACT_LENGTH = 50;

/**
 * Whether a paper can be extracted from: by its PDF when the job reads PDFs, or by its abstract. A paper with a real
 * OpenAlex ID or a DOI may get a PDF without a link of its own: from the paper PDF store, its DOI, or OpenAlex
 * (../lib/paperPdfs.ts).
 */
export function getProcessableFlags(args: {
  pdfUrl?: string | null;
  oaUrl?: string | null;
  storageId?: string | null;
  abstract?: string | null;
  openalexId?: string | null;
  doi?: string | null;
  pdfEnabled: boolean;
}) {
  const hasPdfUrl = args.pdfEnabled && (!!args.pdfUrl || !!args.oaUrl || !!args.storageId || /^(https:\/\/openalex\.org\/)?W\d+$/i.test(args.openalexId ?? "") || !!args.doi);
  const hasAbstract = !!args.abstract && args.abstract.length > MIN_ABSTRACT_LENGTH;
  return {
    hasPdfUrl,
    hasAbstract,
    processable: hasPdfUrl || hasAbstract,
  };
}
