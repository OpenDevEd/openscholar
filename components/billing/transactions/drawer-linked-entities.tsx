"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface Props {
  jobId: string | null;
  paperId: string | null;
  resultId: string | null;
}

type LinkedCard =
  | {
      kind: "link";
      key: "job" | "paper" | "result";
      href: string;
      labelKey: "job" | "paper" | "result";
    }
  | {
      kind: "disabled";
      key: "paper" | "result";
      labelKey: "paperComingSoon" | "resultComingSoon";
    };

export function DrawerLinkedEntities({ jobId, paperId, resultId }: Props) {
  const t = useTranslations("billingPage.transactions.drawer.links");

  const cards: LinkedCard[] = [];
  if (jobId) {
    cards.push({
      kind: "link",
      key: "job",
      href: `/extraction/${jobId}`,
      labelKey: "job",
    });
  }
  if (paperId) {
    // Standalone paper detail route does not exist yet; render a disabled
    // card so the drawer surfaces the association without a broken link.
    cards.push({ kind: "disabled", key: "paper", labelKey: "paperComingSoon" });
  }
  if (resultId) {
    cards.push({
      kind: "disabled",
      key: "result",
      labelKey: "resultComingSoon",
    });
  }

  if (cards.length === 0) return null;

  return (
    <section
      data-drawer-section="linked"
      aria-labelledby="drawer-links-heading"
      className="flex flex-col gap-1"
    >
      <h3
        id="drawer-links-heading"
        className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {t("heading")}
      </h3>
      {cards.map((card) => {
        const base =
          "flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-xs";
        if (card.kind === "disabled") {
          return (
            <div
              key={card.key}
              data-drawer-link={card.key}
              data-drawer-link-state="disabled"
              aria-disabled="true"
              className={cn(base, "cursor-not-allowed text-muted-foreground")}
            >
              {t(card.labelKey)}
              <ChevronRight
                className="size-3.5 text-muted-foreground/60"
                aria-hidden
              />
            </div>
          );
        }
        return (
          <Link
            key={card.key}
            href={card.href}
            data-drawer-link={card.key}
            className={cn(base, "hover:bg-muted/40")}
          >
            {t(card.labelKey)}
            <ChevronRight
              className="size-3.5 text-muted-foreground"
              aria-hidden
            />
          </Link>
        );
      })}
    </section>
  );
}
