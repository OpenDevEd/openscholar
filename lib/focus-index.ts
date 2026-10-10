/**
 * The paper focus mode has open, in the list it reads. Focus mode keeps the paper's place and, when
 * it was opened on a paper or moved to one, the paper's id. The paper stays open when the list is
 * reordered under it, as when a search's likely order arrives; a list of one paper is read on its own.
 */

/** The place in `papers` of the paper open: the paper `paperId` names, wherever it now is, else `index`. */
export function focusedIndex(papers: readonly { id: string }[], paperId: string | null, index: number): number {
  if (papers.length === 1) return 0;
  const named = paperId === null ? -1 : papers.findIndex((paper) => paper.id === paperId);
  return named >= 0 ? named : index;
}
