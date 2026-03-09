"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ListChecks } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { ScreeningProgress } from "@/components/screening/screening-progress";
import { ScreeningJobHistory } from "@/components/screening/screening-job-history";

interface ScreeningJobsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScreeningJobsDialog({
  open,
  onOpenChange,
}: ScreeningJobsDialogProps) {
  const t = useTranslations("screeningDialog");
  const [selectedJobId, setSelectedJobId] = useState<
    Id<"screeningJobs"> | null
  >(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedJobId(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            {t("jobsDialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("jobsDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto pr-2">
          <div className="space-y-4 py-2">
            {selectedJobId && <ScreeningProgress jobId={selectedJobId} />}
            <ScreeningJobHistory
              onSelectJob={(jobId) => setSelectedJobId(jobId)}
              onClose={() => handleOpenChange(false)}
            />
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)}>
            {t("closeDialog")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
