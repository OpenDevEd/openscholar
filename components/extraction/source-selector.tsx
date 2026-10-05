"use client";

import { useEffect } from "react";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "next-intl";
import { HistorySelector } from "./history-selector";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { ZoteroSelector } from "./zotero-selector";
import { LibraryTab } from "./bucket/tabs/library-tab";
import { BulkPdfUpload } from "./bucket/bulk-pdf-upload";
import { useExtractionStore } from "@/lib/store/extraction";
import { useFeatureFlag } from "@/lib/feature-flags/hook";
import { ScreeningSelector } from "./screening-selector";

const SOURCE_TABS = [
  "history",
  "library",
  "screening",
  "zotero",
  "upload",
] as const;
type SourceTab = (typeof SOURCE_TABS)[number];

export function SourceSelector({ paperLimit }: { paperLimit: number }) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringEnum<SourceTab>([...SOURCE_TABS])
      .withDefault("history")
      .withOptions({ history: "replace" }),
  );

  const pdfCapabilityEnabled = useFeatureFlag("extraction.pdf");
  const usePdfs = useExtractionStore((s) => s.draftJob.usePdfs);
  const screeningEnabled = useExtractionStore((s) => s.draftJob.mode === "extraction");
  // PDF upload only makes sense when the capability is on AND the user has
  // opted into PDFs for this job. Chat mode forces `usePdfs` to false, so
  // this naturally hides the tab there too.
  const uploadEnabled = pdfCapabilityEnabled && usePdfs;

  useEffect(() => {
    if (!uploadEnabled && tab === "upload") setTab("history");
  }, [uploadEnabled, tab, setTab]);

  return (
    <Tabs value={tab === "screening" && !screeningEnabled ? "history" : tab} onValueChange={(v) => setTab(v as SourceTab)} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="history">{tc("searchHistory")}</TabsTrigger>
        <TabsTrigger value="library">Library</TabsTrigger>
        {screeningEnabled && <TabsTrigger value="screening">Screening</TabsTrigger>}
        <TabsTrigger value="zotero"><ZoteroIcon className="size-4 shrink-0" aria-hidden />{t("zotero")}</TabsTrigger>
        {uploadEnabled && <TabsTrigger value="upload">Upload</TabsTrigger>}
      </TabsList>
      <TabsContent value="history">
        <HistorySelector paperLimit={paperLimit} />
      </TabsContent>
      <TabsContent value="library">
        <LibraryTab paperLimit={paperLimit} />
      </TabsContent>
      {screeningEnabled && <TabsContent value="screening">
        <ScreeningSelector paperLimit={paperLimit} />
      </TabsContent>}
      <TabsContent value="zotero">
        <ZoteroSelector paperLimit={paperLimit} />
      </TabsContent>
      {uploadEnabled && (
        <TabsContent value="upload">
          <BulkPdfUpload paperLimit={paperLimit} />
        </TabsContent>
      )}
    </Tabs>
  );
}
