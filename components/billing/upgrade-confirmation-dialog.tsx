"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Zap } from "lucide-react";
import { useTranslations, useFormatter } from "next-intl";

export type UpgradePreview = {
  prorationAmountCents: number;
  currency: string;
  immediateChargeCents: number;
  currentPlan: string;
  targetPlan: string;
  proRataCredits: number;
  currentPlanCreditsPerMonth: number;
  targetPlanCreditsPerMonth: number;
  remainingDays: number;
  prorationDate: number;
};

type UpgradeConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isConfirming: boolean;
  preview: UpgradePreview | null;
};

export function UpgradeConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  isConfirming,
  preview,
}: UpgradeConfirmationDialogProps) {
  const t = useTranslations("upgradeDialog");
  const format = useFormatter();

  if (!preview) return null;

  const formattedCharge = format.number(preview.immediateChargeCents / 100, {
    style: "currency",
    currency: preview.currency,
    minimumFractionDigits: 2,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("title", { plan: preview.targetPlan.charAt(0).toUpperCase() + preview.targetPlan.slice(1) })}
          </DialogTitle>
          <DialogDescription>
            {t("prorationExplanation", { days: preview.remainingDays })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Plan change */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm">
              <span className="text-muted-foreground">{t("currentPlan")}: </span>
              <span className="font-medium capitalize">{preview.currentPlan}</span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm">
              <span className="text-muted-foreground">{t("newPlan")}: </span>
              <span className="font-semibold capitalize">{preview.targetPlan}</span>
            </div>
          </div>

          {/* Prorated charge */}
          <div className="rounded-lg border p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("prorationCharge")}</span>
              <span className="text-lg font-semibold">{formattedCharge}</span>
            </div>
          </div>

          {/* Credits info */}
          {preview.proRataCredits > 0 && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  {t("creditsGranted", { credits: preview.proRataCredits.toLocaleString() })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                {t("creditsDetail", { days: preview.remainingDays })}
              </p>
              <p className="text-xs text-muted-foreground pl-6">
                {t("monthlyCreditsAfter", { credits: preview.targetPlanCreditsPerMonth.toLocaleString() })}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isConfirming}
          >
            {t("cancel")}
          </Button>
          <Button onClick={onConfirm} disabled={isConfirming}>
            {isConfirming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("upgrading")}
              </>
            ) : (
              t("confirmUpgrade")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
