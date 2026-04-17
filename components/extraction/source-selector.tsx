"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "next-intl";
import { HistorySelector } from "./history-selector";
import { ZoteroSelector } from "./zotero-selector";
import { LibraryTab } from "./bucket/tabs/library-tab";
import { CollectionsTab } from "./bucket/tabs/collections-tab";
import { BulkPdfUpload } from "./bucket/bulk-pdf-upload";

type SourceTab = "history" | "library" | "collections" | "zotero" | "upload";

export function SourceSelector() {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const [tab, setTab] = useState<SourceTab>("history");

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as SourceTab)} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="history">{tc("searchHistory")}</TabsTrigger>
        <TabsTrigger value="library">Library</TabsTrigger>
        <TabsTrigger value="collections">Collections</TabsTrigger>
        <TabsTrigger value="zotero">{t("zotero")}</TabsTrigger>
        <TabsTrigger value="upload">Upload</TabsTrigger>
      </TabsList>
      <TabsContent value="history">
        <HistorySelector />
      </TabsContent>
      <TabsContent value="library">
        <LibraryTab />
      </TabsContent>
      <TabsContent value="collections">
        <CollectionsTab />
      </TabsContent>
      <TabsContent value="zotero">
        <ZoteroSelector />
      </TabsContent>
      <TabsContent value="upload">
        <BulkPdfUpload />
      </TabsContent>
    </Tabs>
  );
}
