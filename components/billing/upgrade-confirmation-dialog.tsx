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
import { Loader2, ArrowRight, Zap, CreditCard } from "@/components/icons";
import { useTranslations, useFormatter } from "next-intl";

export type UpgradePreview = {
  currency: string;
  immediateChargeCents: number;
  currentPlan: string;
  targetPlan: string;
  /** Granted in full as soon as the upgrade is paid. */
  targetPlanCreditsPerMonth: number;
  /** When the new plan renews, in ms: a month from the upgrade (#860). */
  renewsAt?: number;
  /** The saved card the upgrade charges. */
  card?: { brand: string; last4: string };
  lineItems: Array<{
    description: string;
    amountCents: number;
    currency: string;
  }>;
};

type UpgradeConfirmationDialogProps = {
  /** In place of the upgrade's title, line under it, confirm button, total's label and "Current plan" and "New plan": a change of seats (#862). */
  title?: string;
  description?: string;
  confirmLabel?: string;
  totalLabel?: string;
  labels?: { from: string; to: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isConfirming: boolean;
  preview: UpgradePreview | null;
  cardBrand?: string;
  cardLast4?: string;
};

export function UpgradeConfirmationDialog({
  title,
  description,
  confirmLabel,
  totalLabel,
  labels,
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
          {...(preview.renewsAt || description ? {} : { "aria-describedby": undefined })}
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
            {title ?? t("title", { plan: preview.targetPlan.charAt(0).toUpperCase() + preview.targetPlan.slice(1) })}
          </DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
          {!description && preview.renewsAt && (
            <DialogDescription>
              {t("startsToday", { plan: preview.targetPlan, date: format.dateTime(new Date(preview.renewsAt), { year: "numeric", month: "short", day: "numeric" }) })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Payment method */}
          {cardLast4 && (
            <div className="flex items-center gap-2 text-sm">
              <CreditCard className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                {t("paymentMethod")}:
              </span>
              <span className="capitalize text-muted-foreground">
                {cardBrand}
              </span>
              <span className="font-medium">
                {/* ui-rules-allow: dot-separator -- the masked digits of a card number */}
                &bull;&bull;&bull;&bull; {cardLast4}
              </span>
            </div>
          )}

          {/* Plan change */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="text-sm">
              <span className="text-muted-foreground">{labels?.from ?? t("currentPlan")}: </span>
              <span className="font-medium">{preview.currentPlan}</span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm">
              <span className="text-muted-foreground">{labels?.to ?? t("newPlan")}: </span>
              <span className="font-semibold">{preview.targetPlan}</span>
            </div>
          </div>

          {/* Proration breakdown */}
          <div className="rounded-lg border p-3 space-y-2">
            {(preview.lineItems ?? []).length > 0 && (
              <>
                {preview.lineItems.map((item, index) => (
                  <div key={index} className="flex items-center justify-between text-sm">
                    {/* A long line wraps on a phone rather than pushing the amounts past the dialog's edge (#858). */}
                    <span className="min-w-0 me-2 text-muted-foreground">
                      {item.description}
                    </span>
                    <span className={item.amountCents < 0 ? "shrink-0 ink-success" : "shrink-0"}>
                      {format.number(item.amountCents / 100, {
                        style: "currency",
                        currency: item.currency,
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                ))}
              </>
            )}
            <div className={(preview.lineItems ?? []).length > 0 ? "border-t pt-2 flex items-center justify-between" : "flex items-center justify-between"}>
              <span className={(preview.lineItems ?? []).length > 0 ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
                {totalLabel ?? ((preview.lineItems ?? []).length > 0 ? t("totalCharge") : t("prorationCharge"))}
              </span>
              <span data-testid="upgrade-total-charge" className="text-lg font-semibold">{formattedCharge}</span>
            </div>
          </div>

          {preview.targetPlanCreditsPerMonth > 0 && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  {t("creditsGranted", { credits: format.number(preview.targetPlanCreditsPerMonth) })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground ps-6">
                {t("monthlyCreditsAfter", { credits: format.number(preview.targetPlanCreditsPerMonth) })}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            data-testid="upgrade-cancel-button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isConfirming}
          >
            {t("cancel")}
          </Button>
          <Button data-testid="upgrade-confirm-button" onClick={onConfirm} disabled={isConfirming}>
            {/* An action the caller names, such as removing seats, keeps its name while it runs (#858). */}
            {isConfirming ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {confirmLabel ?? t("upgrading")}
              </>
            ) : (
              confirmLabel ?? t("confirmUpgrade")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
