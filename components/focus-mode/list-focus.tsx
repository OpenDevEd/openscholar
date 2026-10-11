"use client";

import { useMemo, useState } from "react";
import { FocusMode } from "@/components/ui/focus-mode";
import { downloadLibraryEssentialItem, downloadLibraryItem } from "@/lib/library/download-handlers";
import { useRatedPapers } from "@/lib/research/reads";
import { useUIStore } from "@/lib/store";
import type { PaperResult } from "@/lib/types";
import { workUrl } from "@/lib/openalex/work-id";

/** A paper as a job keeps it: what it stored when it took the paper on, whether or not OpenAlex has a record of it. */
export type StoredPaper = {
  openalexId: string;
  title: string;
  abstract?: string;
  doi?: string;
  publicationYear?: number;
  citedByCount?: number;
  authors?: string[];
  authorsUnparsed?: string;
  workType?: string;
  venue?: string;
  isOpenAccess?: boolean;
  oaStatus?: string;
  oaUrl?: string;
  pdfUrl?: string;
};

/** A stored paper as focus mode reads one, so a paper from Zotero or an upload opens the same way as one from OpenAlex. */
function storedPaperResult(paper: StoredPaper): PaperResult {
  const access = {
    ...(paper.isOpenAccess !== undefined ? { is_oa: paper.isOpenAccess } : {}),
    ...(paper.oaStatus ? { oa_status: paper.oaStatus as NonNullable<PaperResult["open_access"]>["oa_status"] } : {}),
    ...(paper.oaUrl ? { oa_url: paper.oaUrl } : {}),
  };
  return {
    // The canonical OpenAlex ID where it has one, so rating, saving and its OpenAlex page all key on it; a Zotero paper keeps its own.
    id: workUrl(paper.openalexId) ?? paper.openalexId,
    title: paper.title,
    abstract: paper.abstract,
    doi: paper.doi,
    publication_year: paper.publicationYear,
    cited_by_count: paper.citedByCount,
    type: paper.workType as PaperResult["type"],
    authorships: paper.authors?.map((name) => ({ author: { id: "", display_name: name } })),
    authors_unparsed: paper.authorsUnparsed,
    primary_location:
      paper.venue || paper.pdfUrl
        ? { ...(paper.venue ? { source: { id: "", display_name: paper.venue } } : {}), ...(paper.pdfUrl ? { pdf_url: paper.pdfUrl } : {}) }
        : undefined,
    open_access: Object.keys(access).length ? access : undefined,
  };
}

/** Opens focus mode on the paper at `index` of the list a page shows. */
export const openListFocus = (index: number) => {
  const ui = useUIStore.getState();
  ui.setFocusModeIndex(index);
  ui.setIsFocusModeOpen(true);
};

/**
 * Focus mode over the papers a page lists: its arrows step through that list, in that order.
 * The order is held from the moment it opens, so a list that reorders as a job's results
 * arrive never swaps the paper being read; each paper still shows its newest data.
 */
export function ListFocus({ papers }: { papers: StoredPaper[] }) {
  const open = useUIStore((state) => state.isFocusModeOpen);
  const read = useMemo(() => papers.map(storedPaperResult), [papers]);
  // Watched while the page shows, so a paper's rating is known when it opens.
  useRatedPapers(read);
  // The list as it was when focus mode opened, kept while it slides out after closing.
  const [held, setHeld] = useState<{ open: boolean; papers: PaperResult[] }>({ open: false, papers: [] });
  if (open !== held.open) setHeld({ open, papers: open ? read : held.papers });
  const latest = new Map(read.map((paper) => [paper.id, paper]));
  const shown = held.papers.length ? held.papers.map((paper) => latest.get(paper.id) ?? paper) : read;
  return <FocusMode isOpen={open} onClose={() => useUIStore.getState().setIsFocusModeOpen(false)} papers={shown} onDownloadItem={downloadLibraryItem} onDownloadEssentialItem={downloadLibraryEssentialItem} />;
}
