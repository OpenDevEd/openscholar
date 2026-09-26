"use client";

import { Check, Copy, Download, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { useCopyToClipboard } from "./use-copy-to-clipboard";
import { TooltipHint } from "@/components/ui/tooltip";

interface Props {
  invoiceId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  checkoutSessionId: string | null;
}

const STRIPE_DASHBOARD = "https://dashboard.stripe.com";

type StripeRow = {
  key: "invoice" | "pi" | "charge" | "checkout";
  labelKey: "invoice" | "paymentIntent" | "charge" | "checkoutSession";
  value: string;
  href: string | null;
};

export function DrawerStripeSection({
  invoiceId,
  paymentIntentId,
  chargeId,
  checkoutSessionId,
}: Props) {
  const t = useTranslations("billingPage.transactions.drawer.stripe");
  const { copy, copiedKey } = useCopyToClipboard();

  const rows: StripeRow[] = [];
  if (invoiceId) {
    rows.push({
      key: "invoice",
      labelKey: "invoice",
      value: invoiceId,
      href: `${STRIPE_DASHBOARD}/invoices/${invoiceId}`,
    });
  }
  if (paymentIntentId) {
    rows.push({
      key: "pi",
      labelKey: "paymentIntent",
      value: paymentIntentId,
      href: `${STRIPE_DASHBOARD}/payments/${paymentIntentId}`,
    });
  }
  if (chargeId) {
    rows.push({
      key: "charge",
      labelKey: "charge",
      value: chargeId,
      href: `${STRIPE_DASHBOARD}/payments/${chargeId}`,
    });
  }
  if (checkoutSessionId) {
    rows.push({
      key: "checkout",
      labelKey: "checkoutSession",
      value: checkoutSessionId,
      href: null,
    });
  }

  return (
    <section
      data-drawer-section="stripe"
      aria-labelledby="drawer-stripe-heading"
      className="rounded-lg border border-border/50 p-3"
    >
      <h3
        id="drawer-stripe-heading"
        className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {t("heading")}
      </h3>
      <dl className="flex flex-col gap-1.5">
        {rows.map(({ key, labelKey, value, href }) => (
          <div
            key={key}
            className="flex items-center gap-2"
            data-stripe-field={key}
          >
            <dt className="w-28 shrink-0 text-[11px] text-muted-foreground">
              {t(labelKey)}
            </dt>
            <dd className="flex min-w-0 flex-1 items-center gap-1">
              <TooltipHint label={value}>
                <code className="truncate font-mono text-[11px]">{value}</code>
              </TooltipHint>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={t("copy")}
                data-stripe-copy={key}
                data-stripe-copied={copiedKey === key || undefined}
                onClick={() => copy(value, key)}
              >
                {copiedKey === key ? (
                  <Check className="size-3" aria-hidden />
                ) : (
                  <Copy className="size-3" aria-hidden />
                )}
              </Button>
              {href && (
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t("openInStripe")}
                >
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-stripe-link={key}
                  >
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </Button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {invoiceId && (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="mt-3 w-full gap-1.5 text-xs"
          data-drawer-receipt-download
        >
          <a
            href={`${STRIPE_DASHBOARD}/invoices/${invoiceId}?print=true`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download className="size-3.5" aria-hidden />
            {t("downloadReceipt")}
          </a>
        </Button>
      )}
    </section>
  );
}
