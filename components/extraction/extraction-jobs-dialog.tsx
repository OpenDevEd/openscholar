"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FlaskConical } from "lucide-react";
import { ExtractionJobHistory } from "@/components/extraction/extraction-job-history";

interface ExtractionJobsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExtractionJobsDialog({
  open,
  onOpenChange,
}: ExtractionJobsDialogProps) {
  const t = useTranslations("extraction");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 pb-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            {t("jobsDialogTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("jobsDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <ExtractionJobHistory onClose={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
