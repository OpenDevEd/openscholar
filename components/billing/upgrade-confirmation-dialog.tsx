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
import { AutoHeight } from "@/components/ui/auto-height";
import { Loader2, ArrowRight, ArrowUpRight, Zap, CreditCard } from "@/components/icons";
import { StatusChip, type StatusTone } from "@/components/evidence-libraries/configuration/status-chip";
import { Segmented } from "@/components/settings/parts";
import { cn } from "@/lib/utils";
import { useState } from "react";
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
  /** Under the total: a purchase's own controls, such as a promo code. */
  extra?: React.ReactNode;
  /** How what it changes to is drawn: green where that is a good state reached, such as a report going live. */
  toTone?: StatusTone;
  /** Opens Stripe's portal, where the saved cards are added, removed and made the default. */
  onManageBilling?: () => void;
  /** Pays this once with a card other than the one shown, on Stripe's page: it offers the saved cards and takes a new one. */
  onOtherCard?: () => void;
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
  extra,
  toTone = "neutral",
  onManageBilling,
  onOtherCard,
}: UpgradeConfirmationDialogProps) {
  const t = useTranslations("upgradeDialog");
  const format = useFormatter();
  // Which card pays, chosen here: the one shown, or another on Stripe's page.
  const [other, setOther] = useState(false);

  if (!preview) return null;

  const lines = preview.lineItems ?? [];
  // ui-rules-allow: dot-separator -- the masked digits of a card number
  const saved = `${(cardBrand ?? "").replace(/^./, (first) => first.toUpperCase())} \u2022\u2022\u2022\u2022 ${cardLast4 ?? ""}`;
  const formattedCharge = format.number(preview.immediateChargeCents / 100, {
    style: "currency",
    currency: preview.currency,
    minimumFractionDigits: 2,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOther(false);
        onOpenChange(next);
      }}
    >
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
          // With large text on a phone one long word is wider than the dialog.
          className="[overflow-wrap:anywhere]"
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
          {/* What it changes and what it comes to, in one panel: the step from one state to the next, over its bill. */}
          <div className="rounded-2xl bg-inset/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="me-auto text-xs font-medium text-muted-foreground">{labels?.from ?? t("currentPlan")}</span>
              <StatusChip tone="neutral">{preview.currentPlan}</StatusChip>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
              <StatusChip tone={toTone}>{preview.targetPlan}</StatusChip>
            </div>
            {/* Lines that change while it's open, such as a promo code's, slide in. */}
            <AutoHeight>
              <div className="pt-4">
                {lines.length > 0 ? (
                  <dl className="space-y-2 text-sm">
                    {lines.map((item, index) => (
                      <div key={index} className="flex items-center justify-between gap-3">
                        {/* A long line wraps on a phone rather than pushing the amounts past the dialog's edge (#858). */}
                        <dt className="min-w-0 text-muted-foreground">{item.description}</dt>
                        {/* Isolated, so a right-to-left page keeps an amount and its currency in their own order. */}
                        <dd className={cn("shrink-0 tabular-nums", item.amountCents < 0 && "ink-success")}>
                          <bdi dir="ltr">{format.number(item.amountCents / 100, { style: "currency", currency: item.currency, minimumFractionDigits: 2 })}</bdi>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <div className={cn("flex flex-wrap items-center justify-between gap-x-3", lines.length > 0 && "mt-2.5 border-t border-border-subtle pt-2.5")}>
                  <span className="text-sm font-medium">{totalLabel ?? (lines.length > 0 ? t("totalCharge") : t("prorationCharge"))}</span>
                  <bdi dir="ltr" data-testid="upgrade-total-charge" className="text-lg/6 font-semibold tabular-nums">
                    {formattedCharge}
                  </bdi>
                </div>
              </div>
            </AutoHeight>
          </div>

          {extra}

          {preview.targetPlanCreditsPerMonth > 0 && (
            <div className="flex items-start gap-2.5 rounded-2xl bg-primary/5 px-4 py-3">
              <Zap className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{t("creditsGranted", { credits: format.number(preview.targetPlanCreditsPerMonth) })}</p>
                <p className="text-xs text-muted-foreground">{t("monthlyCreditsAfter", { credits: format.number(preview.targetPlanCreditsPerMonth) })}</p>
              </div>
            </div>
          )}

          {/* The card it is charged to, with the two ways to another: for this once on Stripe's page, which offers the
              saved cards and takes a new one, or for good in Stripe's portal. */}
          {cardLast4 ? (
            <div>
              {/* Its name and the way to the saved cards share the line above it, so the choice has the dialog's width whatever the card is called. */}
              <div className="flex items-center gap-3 pb-1.5 ps-1">
                <span className="text-xs font-medium text-muted-foreground">{t("paymentMethod")}</span>
                {onManageBilling ? (
                  <Button variant="ghost" size="sm" className="-my-1 -me-2 ms-auto h-7 text-xs text-muted-foreground" disabled={isConfirming} onClick={onManageBilling}>
                    {t("manageBilling")}
                    <ArrowUpRight />
                  </Button>
                ) : null}
              </div>
              {onOtherCard ? (
                <Segmented
                  size="md"
                  fill="labels"
                  label={t("paymentMethod")}
                  value={other ? "other" : "saved"}
                  onChange={(next) => setOther(next === "other")}
                  options={[
                    { id: "saved", label: saved, icon: CreditCard },
                    { id: "other", label: t("anotherCard") },
                  ]}
                />
              ) : (
                <span className="flex h-9 items-center gap-2 rounded-xl bg-inset px-3 text-sm font-medium">
                  <CreditCard className="size-4 text-muted-foreground" />
                  {saved}
                </span>
              )}
              <AutoHeight>{other ? <p className="ps-1 pt-2 text-xs text-pretty text-muted-foreground">{t("anotherCardNote")}</p> : null}</AutoHeight>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            data-testid="upgrade-cancel-button"
            variant="outline"
            className="h-auto min-h-9 py-1 whitespace-normal"
            onClick={() => onOpenChange(false)}
            disabled={isConfirming}
          >
            {t("cancel")}
          </Button>
          <Button data-testid="upgrade-confirm-button" className="h-auto min-h-9 py-1 whitespace-normal" onClick={other && onOtherCard ? onOtherCard : onConfirm} disabled={isConfirming}>
            {/* An action the caller names, such as removing seats, keeps its name while it runs (#858). */}
            {isConfirming ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {confirmLabel ?? t("upgrading")}
              </>
            ) : other ? (
              t("toPayment")
            ) : (
              confirmLabel ?? t("confirmUpgrade")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
