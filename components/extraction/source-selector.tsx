"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "next-intl";
import { useExtractionStore } from "@/lib/store/extraction";
import { HistorySelector } from "./history-selector";
import { ZoteroSelector } from "./zotero-selector";
import { ManualItems } from "./manual-items";

export function SourceSelector() {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const { draftJob, setActiveSourceTab } = useExtractionStore();

  return (
    <Tabs value={draftJob.activeSourceTab} onValueChange={(v) => setActiveSourceTab(v as "history" | "zotero" | "manual")} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="history">{tc("searchHistory")}</TabsTrigger>
        <TabsTrigger value="zotero">{t("zotero")}</TabsTrigger>
        <TabsTrigger value="manual">{tc("manual")}</TabsTrigger>
      </TabsList>
      <TabsContent value="history">
        <HistorySelector />
      </TabsContent>
      <TabsContent value="zotero">
        <ZoteroSelector />
      </TabsContent>
      <TabsContent value="manual">
        <ManualItems />
      </TabsContent>
    </Tabs>
  );
}
