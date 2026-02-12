"use client";

import { useExtractionStore } from "@/lib/store/extraction";
import { useTranslations } from "next-intl";

export function SourceSummary() {
  const t = useTranslations("extraction");
  const { draftJob } = useExtractionStore();
  const historyCount = draftJob.selectedHistoryIds.length;
  const zoteroCount = draftJob.zoteroSelection?.items.length || 0;
  const manualCount = draftJob.manualItems.length;

  return (
    <div className="text-sm text-muted-foreground">
      {t("sourceSummary", { history: historyCount, zotero: zoteroCount, manual: manualCount })}
    </div>
  );
}
