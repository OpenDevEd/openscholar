"use client";

import { useExtractionStore } from "@/lib/store/extraction";

export function SourceSummary() {
  const { draftJob } = useExtractionStore();
  const historyCount = draftJob.selectedHistoryIds.length;
  const zoteroCount = draftJob.zoteroSelection?.items.length || 0;
  const manualCount = draftJob.manualItems.length;

  return (
    <div className="text-sm text-muted-foreground">
      {historyCount} history • {zoteroCount} Zotero • {manualCount} manual
    </div>
  );
}
