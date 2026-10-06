"use client";

import { useMemo } from "react";
import { FocusMode } from "@/components/ui/focus-mode";
import { downloadLibraryEssentialItem, downloadLibraryItem } from "@/lib/library/download-handlers";
import { useRatedPapers } from "@/lib/research/reads";
import { useUIStore } from "@/lib/store";
import type { PaperResult } from "@/lib/types";

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
export function storedPaperResult(paper: StoredPaper): PaperResult {
  const access = {
    ...(paper.isOpenAccess !== undefined ? { is_oa: paper.isOpenAccess } : {}),
    ...(paper.oaStatus ? { oa_status: paper.oaStatus as NonNullable<PaperResult["open_access"]>["oa_status"] } : {}),
    ...(paper.oaUrl ? { oa_url: paper.oaUrl } : {}),
  };
  return {
    id: paper.openalexId,
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

/** Focus mode over the papers a page lists: its arrows step through that list, in that order. */
export function ListFocus({ papers }: { papers: StoredPaper[] }) {
  const open = useUIStore((state) => state.isFocusModeOpen);
  const read = useMemo(() => papers.map(storedPaperResult), [papers]);
  const rated = useRatedPapers(read);
  return <FocusMode isOpen={open} onClose={() => useUIStore.getState().setIsFocusModeOpen(false)} papers={rated.papers} onDownloadItem={downloadLibraryItem} onDownloadEssentialItem={downloadLibraryEssentialItem} />;
}
