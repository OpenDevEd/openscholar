"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HistorySelector } from "./history-selector";
import { ZoteroSelector } from "./zotero-selector";
import { ManualItems } from "./manual-items";

export function SourceSelector() {
  return (
    <Tabs defaultValue="history" className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="history">Search History</TabsTrigger>
        <TabsTrigger value="zotero">Zotero</TabsTrigger>
        <TabsTrigger value="manual">Manual</TabsTrigger>
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
