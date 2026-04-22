"use client";

import { useEffect } from "react";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "next-intl";
import { HistorySelector } from "./history-selector";
import { ZoteroSelector } from "./zotero-selector";
import { LibraryTab } from "./bucket/tabs/library-tab";
import { BulkPdfUpload } from "./bucket/bulk-pdf-upload";
import { useExtractionStore } from "@/lib/store/extraction";
import { useFeatureFlag } from "@/lib/feature-flags/hook";

const SOURCE_TABS = [
  "history",
  "library",
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
  // PDF upload only makes sense when the capability is on AND the user has
  // opted into PDFs for this job. Chat mode forces `usePdfs` to false, so
  // this naturally hides the tab there too.
  const uploadEnabled = pdfCapabilityEnabled && usePdfs;

  useEffect(() => {
    if (!uploadEnabled && tab === "upload") setTab("history");
  }, [uploadEnabled, tab, setTab]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as SourceTab)} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="history">{tc("searchHistory")}</TabsTrigger>
        <TabsTrigger value="library">Library</TabsTrigger>
        <TabsTrigger value="zotero">{t("zotero")}</TabsTrigger>
        {uploadEnabled && <TabsTrigger value="upload">Upload</TabsTrigger>}
      </TabsList>
      <TabsContent value="history">
        <HistorySelector paperLimit={paperLimit} />
      </TabsContent>
      <TabsContent value="library">
        <LibraryTab paperLimit={paperLimit} />
      </TabsContent>
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
