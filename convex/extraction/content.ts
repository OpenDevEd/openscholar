export const MIN_ABSTRACT_LENGTH = 50;

export function getProcessableFlags(args: {
  pdfUrl?: string | null;
  storageId?: string | null;
  abstract?: string | null;
}) {
  const hasPdfUrl = !!args.pdfUrl || !!args.storageId;
  const hasAbstract = !!args.abstract && args.abstract.length > MIN_ABSTRACT_LENGTH;
  return {
    hasPdfUrl,
    hasAbstract,
    processable: hasPdfUrl || hasAbstract,
  };
}
