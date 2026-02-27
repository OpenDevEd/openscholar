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
import { Loader2, ArrowRight, Zap, CreditCard } from "lucide-react";
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
  lineItems: Array<{
    description: string;
    amountCents: number;
    currency: string;
  }>;
};

type UpgradeConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isConfirming: boolean;
  preview: UpgradePreview | null;
  cardBrand?: string;
  cardLast4?: string;
};

export function UpgradeConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  isConfirming,
  preview,
  cardBrand,
  cardLast4,
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
      <DialogContent
          onEscapeKeyDown={(e) => {
            if (isConfirming) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (isConfirming) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isConfirming) e.preventDefault();
          }}
          showCloseButton={!isConfirming}
        >
        <DialogHeader>
          <DialogTitle>
            {t("title", { plan: preview.targetPlan.charAt(0).toUpperCase() + preview.targetPlan.slice(1) })}
          </DialogTitle>
          <DialogDescription>
            {t("prorationExplanation", { days: preview.remainingDays })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Payment method */}
          {cardLast4 && (
            <div className="flex items-center gap-2 text-sm">
              <CreditCard className="w-4 h-4 text-muted-foreground" />
              <span className="capitalize text-muted-foreground">
                {cardBrand}
              </span>
              <span className="font-medium">
                &bull;&bull;&bull;&bull; {cardLast4}
              </span>
            </div>
          )}

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

          {/* Proration breakdown */}
          <div className="rounded-lg border p-3 space-y-2">
            {preview.lineItems.length > 0 ? (
              <>
                {preview.lineItems.map((item, index) => (
                  <div key={index} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground truncate mr-2">
                      {item.description}
                    </span>
                    <span className={item.amountCents < 0 ? "text-green-600" : ""}>
                      {format.number(item.amountCents / 100, {
                        style: "currency",
                        currency: item.currency,
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                ))}
                <div className="border-t pt-2 flex items-center justify-between">
                  <span className="text-sm font-medium">{t("totalCharge")}</span>
                  <span className="text-lg font-semibold">{formattedCharge}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("prorationCharge")}</span>
                <span className="text-lg font-semibold">{formattedCharge}</span>
              </div>
            )}
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
