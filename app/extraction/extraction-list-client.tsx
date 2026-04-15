"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FlaskConical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExtractionJobHistory } from "@/components/extraction/extraction-job-history";
import { ExtractionDialog } from "@/components/extraction/extraction-dialog";

export function ExtractionListClient() {
  const t = useTranslations("extraction");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <FlaskConical className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">{t("results.title")}</h1>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)} size="sm">
          <Plus className="h-4 w-4" />
          <span>{t("jobCreation.title")}</span>
        </Button>
      </div>

      {/* Job history list */}
      <ExtractionJobHistory />

      {/* Creation dialog -- no pre-selected papers from list page */}
      <ExtractionDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </div>
  );
}
