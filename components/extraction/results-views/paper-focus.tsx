"use client";

import { useMemo } from "react";
import { FocusMode } from "@/components/ui/focus-mode";
import { extractionPaperToPaperResult } from "@/lib/extraction/paper-result";
import type { PaperWithResults } from "@/lib/extraction/filtering";
import { downloadLibraryEssentialItem, downloadLibraryItem } from "@/lib/library/download-handlers";
import { useRatedPapers } from "@/lib/research/reads";
import { useUIStore } from "@/lib/store";

/** Opens focus mode on the paper at `index` of the list the page shows. */
export const openPaperFocus = (index: number) => {
  const ui = useUIStore.getState();
  ui.setFocusModeIndex(index);
  ui.setIsFocusModeOpen(true);
};

/** Focus mode over the job's papers as the page lists them: its arrows step through that list, in that order. */
export function PaperFocus({ papers }: { papers: PaperWithResults[] }) {
  const open = useUIStore((state) => state.isFocusModeOpen);
  const read = useMemo(() => papers.map(extractionPaperToPaperResult), [papers]);
  const rated = useRatedPapers(read);
  return <FocusMode isOpen={open} onClose={() => useUIStore.getState().setIsFocusModeOpen(false)} papers={rated.papers} onDownloadItem={downloadLibraryItem} onDownloadEssentialItem={downloadLibraryEssentialItem} />;
}
