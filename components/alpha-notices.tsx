"use client";

// The public alpha's notices: the strip across every page, the one on the Pricing page, and the
// button that asks for what's given by request.

import { useTranslations } from "next-intl";
import { FlaskConical, Mail } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { CONTACT_EMAIL } from "@/lib/billing/contact";

/**
 * Across the top of every page, where it stays as the page scrolls. The layout counts its height in `--app-navbar-height`.
 * Over the pages' sticky headers (z-20) and under the rail (z-40), whose workspace card opens across it.
 */
export function AlphaStrip() {
  const t = useTranslations("alpha");
  return (
    <div className="sticky top-0 z-30 flex h-8 shrink-0 items-center justify-center gap-2 border-b border-warning/25 bg-[color-mix(in_oklab,var(--warning)_14%,var(--background))] px-4 text-xs dark:bg-[color-mix(in_oklab,var(--warning)_30%,var(--background))]">
      <FlaskConical className="size-3.5 shrink-0 ink-warning" />
      <span className="truncate">
        <span className="font-semibold">{t("strip")}</span> <span className="hidden text-muted-foreground sm:inline">{t("stripDetail")}</span>
      </span>
      <a href={`mailto:${CONTACT_EMAIL}`} className="shrink-0 font-medium underline underline-offset-2">
        {t("contactUs")}
      </a>
    </div>
  );
}

/** At the top of the Pricing page, in the notice style it already uses. */
export function AlphaPlansNotice() {
  const t = useTranslations("alpha");
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm ink-info">
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <span>{t("plansNotice")}</span>
    </div>
  );
}

/** For what's given by request: the address is on the button, so it works with no mail app set up. */
export function ContactButton({ href, variant = "default" }: { href: string; variant?: "default" | "outline" }) {
  const t = useTranslations("alpha");
  return (
    <Button asChild variant={variant} className="w-full">
      <a href={href}>
        <Mail /> {t("emailAddress", { email: CONTACT_EMAIL })}
      </a>
    </Button>
  );
}
