"use client";

import { ChevronLeft, ChevronRight, type AppIcon } from "@/components/icons";
import Link from "@/components/workspace-link";
import type { MouseEventHandler, ReactNode } from "react";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
import { LibraryImage } from "../library-image";

/** On a narrow page a bar action keeps its icon; wrap its label in BAR_LABEL so screen readers still read it. */
export const BAR_ACTION = "@max-3xl:w-8 @max-3xl:px-0";
export const BAR_LABEL = "@max-3xl:sr-only";

/**
 * The page's command bar: one row as tall as the sidebar's logo section. It answers to
 * the page's own width (the nearest `@container`), and the page shell shows what no
 * longer fits inside its card instead. Under 30rem (a phone, or a tablet at large text; a
 * tablet at normal text is 40rem or wider) the actions go on a line of their own under the
 * title when the whole title doesn't fit beside them: the configuration bar's two actions
 * left a community's name no room at all on a 360px phone. Under 18rem their labels wrap
 * too, rather than run off the screen.
 */
export function PanelHeader({
  icon: Icon,
  image,
  title,
  backHref,
  backLabel,
  onBackClick,
  trail,
  titleAside,
  tabs,
  filters,
  children,
}: {
  /** Null while the page is still loading and its kind is not known yet. */
  icon: AppIcon | null;
  /** A library page: its favicon, or null for the OpenScholar one. Leave undefined for the icon. */
  image?: string | null;
  title: string;
  /** Where the back chevron goes. */
  backHref?: string;
  backLabel?: string;
  onBackClick?: MouseEventHandler<HTMLAnchorElement>;
  /** The pages above this one, nearest last, each a link before the title. Where the bar is too narrow for them, the back chevron goes to the nearest. */
  trail?: Array<{ label: string; href: string }>;
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
  const parent = trail?.at(-1);
  const back = backHref ?? parent?.href;
  return (
    <div className="flex h-16 items-center gap-4 @max-[30rem]:h-auto @max-[30rem]:min-h-16 @max-[30rem]:flex-wrap @max-[30rem]:gap-y-2 @max-[30rem]:py-3">
      {/* Under 18rem (a phone at 150% text or more) a title that doesn't fit beside the back arrow, picture and chips takes a line of its own: beside them it had 46 to 86px and broke inside its words.
          The row takes its height as a slide, so a title and chips that arrive after the loading page's empty bar open it
          smoothly: on /publish at 360px and 200% text the bar grew from 129px to 281px in one frame. From 18rem up the bar keeps its
          height and the row shows at once, as before. Across, nothing is clipped,
          for the back arrow's negative margin. */}
      <AutoHeight className="min-w-0 flex-1 overflow-x-visible @3xl:flex-initial @min-[18rem]:h-auto! @max-[30rem]:basis-auto">
        <div className="flex min-w-0 items-center gap-2 @max-[18rem]:flex-wrap">
          {back ? (
            <Button asChild variant="ghost" size="icon" className={parent ? "-ms-2 shrink-0 text-muted-foreground @3xl:hidden" : "-ms-2 shrink-0 text-muted-foreground"}>
              <Link href={back} aria-label={backLabel ?? (parent ? `Back to ${parent.label}` : undefined)} onClick={onBackClick}>
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
          {trail?.length ? (
            <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink items-center @3xl:flex">
              <ol className="flex min-w-0 items-center gap-2">
                {trail.map((crumb) => (
                  <li key={crumb.href} className="flex min-w-0 items-center gap-2">
                    <Link href={crumb.href} className="max-w-56 truncate rounded-sm text-base text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">{crumb.label}</Link>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          {title ? (
            // At large text on a phone (under 18rem) a title too long for its line wraps: "Verify Agent Library" was "Ver…" at 360px
            // and 200% text. At normal text it stays one line.
            <TooltipHint label={title} onlyWhenClipped>
              <h1 className="truncate text-base font-semibold @max-[18rem]:whitespace-normal @max-[18rem]:wrap-break-word">{title}</h1>
            </TooltipHint>
          ) : null}
          {titleAside ? <div className="flex shrink-0 items-center gap-2">{titleAside}</div> : null}
        </div>
      </AutoHeight>
      {/* The view switch and the filters are inset wells, made for a white card. The light bar is the page's grey, so here they take the card's white. */}
      {tabs ? <div className="hidden shrink-0 border-s border-border-subtle ps-4 not-dark:[--inset:var(--card)] @3xl:block max-lg:has-[[data-view-switch]]:hidden!">{tabs}</div> : null}
      {filters || children ? (
        <div className="ms-auto flex shrink-0 items-center gap-2 @max-[30rem]:ms-0 @max-[18rem]:max-w-full @max-[18rem]:flex-wrap @max-[18rem]:[&_button]:h-auto @max-[18rem]:[&_button]:min-h-8 @max-[18rem]:[&_button]:max-w-full @max-[18rem]:[&_button]:whitespace-normal">
          {filters ? <div className="hidden items-center gap-2 not-dark:[--inset:var(--card)] @6xl:flex">{filters}</div> : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
