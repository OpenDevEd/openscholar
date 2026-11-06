"use client";

// The public alpha's notices: the strip across every page, the one on the Pricing page, and the
// button that asks for what's given by request.

import { useTranslations } from "next-intl";
import { FlaskConical } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { contactPage } from "@/lib/billing/contact";
import { cn } from "@/lib/utils";

/**
 * Across the top of every page, where it stays as the page scrolls. The layout counts its height in `--app-navbar-height`.
 * Over the pages' sticky headers (z-20) and under the rail (z-40), whose workspace card opens across it.
 */
export function AlphaStrip() {
  const t = useTranslations("alpha");
  const tc = useTranslations("common");
  return (
    <div className="sticky top-0 z-30 flex h-8 shrink-0 items-center justify-center gap-2 border-b border-warning/25 bg-[color-mix(in_oklab,var(--warning)_14%,var(--background))] px-4 text-xs dark:bg-[color-mix(in_oklab,var(--warning)_30%,var(--background))]">
      <FlaskConical className="size-3.5 shrink-0 ink-warning" />
      <span className="truncate">
        <span className="font-semibold">{t("strip")}</span> <span className="hidden text-muted-foreground sm:inline">{t("stripDetail")}</span>
      </span>
      <a href={contactPage("bug")} className="shrink-0 font-medium underline underline-offset-2">
        {tc("reportProblem")}
      </a>
    </div>
  );
}

/** On the Pricing page, as two lines of type: against the header's edge, or under the plans where the header has no room. */
export function AlphaPlansNotice({ className }: { className?: string }) {
  const t = useTranslations("alpha");
  return (
    <div className={cn("flex flex-col items-start @6xl:items-end @6xl:text-end", className)}>
      <span className="text-sm font-semibold leading-5">{t("plansNoticeTitle")}</span>
      <span className="text-xs leading-4 text-muted-foreground">{t("plansNoticeDetail")}</span>
    </div>
  );
}

/** For what's given by request: opens the contact form at the request's topic. */
export function ContactButton({ href, label, variant = "default" }: { href: string; label: string; variant?: "default" | "outline" }) {
  return (
    <Button asChild variant={variant} className="w-full">
      <a href={href}>{label}</a>
    </Button>
  );
}
