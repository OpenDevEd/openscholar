"use client";

// Mock (mock/ai-overview): the papers an overview cites, for the results page's focus mode. They're
// usually not among the results the page has loaded, so focus mode steps through the overview's own
// list when it's opened from there (components/results-list.tsx).

import { create } from "zustand";
import { useUIStore } from "@/lib/store";
import type { PaperResult } from "@/lib/types";

export const useCitedFocus = create<{ papers: PaperResult[] | null }>(() => ({ papers: null }));

/** Opens focus mode on the overview's cited paper at `index`. */
export function openCited(papers: PaperResult[], index: number) {
  useCitedFocus.setState({ papers });
  const ui = useUIStore.getState();
  ui.setFocusModeIndex(index);
  ui.setIsFocusModeOpen(true);
}
