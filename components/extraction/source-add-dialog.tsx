"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, Upload, FileText, BookOpen } from "lucide-react";
import { SourceSearchHistory } from "./source-search-history";
import { SourceUpload } from "./source-upload";
import { SourceManual } from "./source-manual";
import { SourceZotero } from "./source-zotero";
import type { Id } from "@/convex/_generated/dataModel";

interface SourceAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysisId: Id<"analyses">;
  onSuccess?: () => void;
}

export function SourceAddDialog({
  open,
  onOpenChange,
  analysisId,
  onSuccess,
}: SourceAddDialogProps) {
  const [activeTab, setActiveTab] = useState("search-history");

  const handleSuccess = () => {
    onSuccess?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Documents</DialogTitle>
          <DialogDescription>
            Import documents from various sources to your analysis.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="search-history" className="gap-2">
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">History</span>
            </TabsTrigger>
            <TabsTrigger value="zotero" className="gap-2">
              <BookOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Zotero</span>
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Upload</span>
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">Manual</span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-auto mt-4">
            <TabsContent value="search-history" className="m-0 h-full">
              <SourceSearchHistory
                analysisId={analysisId}
                onSuccess={handleSuccess}
              />
            </TabsContent>

            <TabsContent value="zotero" className="m-0 h-full">
              <SourceZotero
                analysisId={analysisId}
                onSuccess={handleSuccess}
              />
            </TabsContent>

            <TabsContent value="upload" className="m-0 h-full">
              <SourceUpload
                analysisId={analysisId}
                onSuccess={handleSuccess}
              />
            </TabsContent>

            <TabsContent value="manual" className="m-0 h-full">
              <SourceManual
                analysisId={analysisId}
                onSuccess={handleSuccess}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
