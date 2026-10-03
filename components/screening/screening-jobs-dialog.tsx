"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListChecks } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
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
  // Read while the dialog is closed, so it opens at the size its first page takes.
  const { data: total } = useProtectedQuery(api.screening.queries.countUserScreeningJobs, {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="shrink-0 pb-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" />
            {t("jobsDialogTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("jobsDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <ScreeningJobHistory total={total} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
