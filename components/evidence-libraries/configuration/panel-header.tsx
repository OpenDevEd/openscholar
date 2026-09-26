"use client";

import { ChevronLeft, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { LibraryImage } from "../library-image";

/** On a narrow page a bar action keeps its icon; wrap its label in BAR_LABEL so screen readers still read it. */
export const BAR_ACTION = "@max-3xl:w-8 @max-3xl:px-0";
export const BAR_LABEL = "@max-3xl:sr-only";

/**
 * The page's command bar: one row as tall as the sidebar's logo section. It never
 * wraps. It answers to the page's own width (the nearest `@container`), and the
 * page shell shows what no longer fits inside its card instead.
 */
export function PanelHeader({
  icon: Icon,
  image,
  title,
  backHref,
  backLabel,
  titleAside,
  tabs,
  filters,
  children,
}: {
  /** Null while the page is still loading and its kind is not known yet. */
  icon: LucideIcon | null;
  /** A library page: its favicon, or null for the OpenScholar one. Leave undefined for the icon. */
  image?: string | null;
  title: string;
  /** Where the back chevron goes. */
  backHref?: string;
  backLabel?: string;
  /** Shown right after the title, such as a state chip. */
  titleAside?: ReactNode;
  /** Views of the list, shown in the bar on wide pages. */
  tabs?: ReactNode;
  /** Search and filters, shown in the bar on the widest pages. */
  filters?: ReactNode;
  /** Actions. */
  children?: ReactNode;
}) {
  const icon = Icon ? <Icon aria-hidden className="size-4.5 shrink-0 text-primary" /> : null;
  return (
    <div className="flex h-16 items-center gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 @3xl:flex-initial">
        {backHref ? (
          <Button asChild variant="ghost" size="icon" className="-ml-2 shrink-0 text-muted-foreground">
            <Link href={backHref} aria-label={backLabel}>
              <ChevronLeft className="size-5" />
            </Link>
          </Button>
        ) : null}
        {image !== undefined ? (
          <LibraryImage
            src={image ?? "/icon.svg"}
            className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md"
            imageClassName={image ? "size-full object-cover" : "size-5 object-contain"}
            fallback={icon}
          />
        ) : icon}
        {title ? (
          <TooltipHint label={title} onlyWhenClipped>
            <h1 className="truncate text-base font-semibold">{title}</h1>
          </TooltipHint>
        ) : null}
        {titleAside ? <div className="flex shrink-0 items-center gap-2">{titleAside}</div> : null}
      </div>
      {tabs ? <div className="hidden shrink-0 border-l border-border/60 pl-4 @3xl:block">{tabs}</div> : null}
      {filters || children ? (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {filters ? <div className="hidden items-center gap-2 @6xl:flex">{filters}</div> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
