"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download } from "@/components/icons";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExportDialog } from "./export-dialog";
import type { PaperWithResults, Question } from "@/lib/extraction/filtering";

interface BulkActionsBarProps {
  selectedIds: Set<string>;
  papers: PaperWithResults[];
  questions: Question[];
  onClearSelection: () => void;
}

export function BulkActionsBar({
  selectedIds,
  papers,
  questions,
  onClearSelection,
}: BulkActionsBarProps) {
  const t = useTranslations("extraction");
  const tc = useTranslations("common");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  return (
    <>
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <Card className="shadow-2xl border-primary/20 py-4">
              <CardContent className="flex items-center gap-4 px-6">
                <span className="text-sm font-medium">
                  {t("nPapersSelected", { count: selectedIds.size })}
                </span>
                <div className="h-6 w-px bg-border" />
                <Button
                  size="sm"
                  onClick={() => setExportDialogOpen(true)}
                >
                  <Download className="w-4 h-4 mr-2" />
                  {t("exportSelected")}
                </Button>
                <div className="h-6 w-px bg-border" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClearSelection}
                >
                  {tc("clear")}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        loadPapers={async () => papers}
        paperCount={papers.length}
        questions={questions}
        label={tc("paperCount", { count: selectedIds.size })}
      />
    </>
  );
}
