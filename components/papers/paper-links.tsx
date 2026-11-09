"use client";

import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import Link from "@/components/workspace-link";
import { ArrowUpRight, Share2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { useCloseFocus } from "@/components/focus-mode/close-context";
import { ourPaperPage } from "@/lib/papers/page-address";
import { cn } from "@/lib/utils";

type Paper = Parameters<typeof ourPaperPage>[0];

/** Sits inside cards and rows that open on a click or Enter of their own, as Cite does. */
const keepClick = (event: MouseEvent) => event.stopPropagation();
const keepKeys = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") event.stopPropagation();
};

/** A control on a card (`compact`: an icon with its name as a tooltip, like Cite) or in a bar (its name beside the icon). */
function Control({ compact, label, className, children }: { compact: boolean; label: string; className?: string; children: (button: { variant: "ghost" | "outline"; size: "icon" | "sm"; className: string; "aria-label"?: string }) => ReactElement }) {
  const props = { variant: compact ? ("ghost" as const) : ("outline" as const), size: compact ? ("icon" as const) : ("sm" as const), className: cn(compact && "size-8", className), "aria-label": compact ? label : undefined };
  return compact ? <TooltipHint label={label}>{children(props)}</TooltipHint> : <>{children(props)}</>;
}

/** Opens the paper's own page here, in the same tab; inside focus mode the sheet closes as it goes. */
export function PaperPageLink({ paper, compact = true, className, labelClassName = "hidden sm:inline" }: { paper: Paper; compact?: boolean; className?: string; labelClassName?: string }) {
  const t = useTranslations("paperPage");
  const closeFocus = useCloseFocus();
  const href = ourPaperPage(paper);
  if (!href) return null;
  return (
    <Control compact={compact} label={t("paperPage")} className={className}>
      {(button) => (
        <Button {...button} asChild>
          <Link href={href} onClick={keepClick} onKeyDown={keepKeys} onNavigate={closeFocus}>
            <ArrowUpRight aria-hidden className="size-4" />
            {compact ? null : <span className={labelClassName}>{t("paperPage")}</span>}
          </Link>
        </Button>
      )}
    </Control>
  );
}

/**
 * Shares a paper's page: a phone or tablet offers its own share sheet, anything else copies the link. Null for a paper
 * with no page here. `href` names the page when the caller already knows its address, as the page itself does.
 */
export function usePaperShare(paper: Paper | undefined, href?: string): (() => Promise<void>) | null {
  const t = useTranslations("paperPage");
  const tTopics = useTranslations("topics");
  const path = href ?? (paper ? ourPaperPage(paper) : null);
  if (!paper || !path) return null;
  return async () => {
    const url = new URL(path, location.origin).href;
    const title = paper.title ?? paper.display_name ?? undefined;
    // A touch screen's share sheet reaches its apps; a desktop's mostly duplicates copying, so the link is copied there.
    if (typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if ((error as DOMException).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(tTopics("copyFailed"));
    }
  };
}

/** Share for a card (`compact`) or a bar (named beside its icon). */
export function PaperShare({ paper, href, compact = true, className, labelClassName = "hidden sm:inline" }: { paper: Paper; href?: string; compact?: boolean; className?: string; labelClassName?: string }) {
  const t = useTranslations("paperPage");
  const share = usePaperShare(paper, href);
  if (!share) return null;
  return (
    <Control compact={compact} label={t("share")} className={className}>
      {(button) => (
        <Button {...button} type="button" onKeyDown={keepKeys} onClick={(event) => { keepClick(event); void share(); }}>
          <Share2 aria-hidden className="size-4" />
          {compact ? null : <span className={labelClassName}>{t("share")}</span>}
        </Button>
      )}
    </Control>
  );
}
