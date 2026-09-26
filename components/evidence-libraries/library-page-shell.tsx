"use client";

import { Layers, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { StickyPageHeader } from "@/components/layout/sticky-page-header";
import { cn } from "@/lib/utils";
import { PanelHeader } from "./configuration/panel-header";
import { ListLoading } from "./list-controls";

/**
 * The page frame shared by the library, topic, author, history and bookmark
 * pages: the sticky command bar, then one elevated card holding the page.
 *
 * Tabs and filters render in both places and CSS shows one copy, so nothing
 * moves after load. Whatever the bar cannot fit at the page's width shows in the
 * card's toolbar instead: filters first, then tabs.
 */
export function LibraryPageShell({
  icon = Layers,
  image,
  title,
  backHref,
  backLabel,
  titleAside,
  tabs,
  filters,
  actions,
  intro,
  filtersInCard = false,
  children,
}: {
  icon?: LucideIcon | null;
  image?: string | null;
  title: string;
  backHref?: string;
  backLabel?: string;
  titleAside?: ReactNode;
  tabs?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  /** The top of a detail page's card, above the toolbar and the list. */
  intro?: ReactNode;
  /** Keep the filters in the card at every width, for a search that belongs to one tab's list. */
  filtersInCard?: boolean;
  children: ReactNode;
}) {
  // A tab can drop its filters. The last ones stay rendered while their row closes.
  const [keptFilters, keepFilters] = useState(filters);
  if (filters && filters !== keptFilters) keepFilters(filters);
  const cardFilters = filters || keptFilters;
  const filtersInBar = !filtersInCard && filters;
  // The card toolbar closes at the width where the bar holds everything it has.
  const cardToolbar = filtersInCard && filters ? OPEN : filtersInBar ? "grid-rows-[1fr] @6xl:invisible @6xl:grid-rows-[0fr]" : "grid-rows-[1fr] @3xl:invisible @3xl:grid-rows-[0fr]";
  return (
    <div className="@container w-full pb-16">
      <StickyPageHeader>
        <PanelHeader
          icon={icon}
          image={image}
          title={title}
          backHref={backHref}
          backLabel={backLabel}
          titleAside={titleAside}
          tabs={tabs}
          filters={filtersInBar}
        >
          {actions}
        </PanelHeader>
      </StickyPageHeader>

      <div className="container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer>
          {intro ? <div className="border-b border-border/50">{intro}</div> : null}
          {tabs || cardFilters ? (
            <Collapse className={cardToolbar}>
              <div className="flex flex-wrap items-center gap-x-3 border-b border-border/50 p-4">
                {tabs ? <div className="-mx-1 max-w-full overflow-x-auto px-1 @3xl:hidden">{tabs}</div> : null}
                {cardFilters ? (
                  <Collapse className={cn("w-full min-w-0 @lg:w-auto @lg:flex-1", filters ? OPEN : CLOSED)}>
                    {/* Filters sit beside the tabs in equal columns. On a phone they go two to a row, and a lone or leading filter takes the full row. */}
                    <div className={cn("grid gap-2 [&>*]:w-full [&_input]:w-full @max-lg:grid-cols-2 @max-lg:[&>:only-child]:col-span-2 @max-lg:[&>:first-child:nth-last-child(3)]:col-span-2", tabs && "pt-3 @lg:pt-0", filtersInCard ? "@lg:ml-auto @lg:w-64" : "@lg:grid-flow-col @lg:auto-cols-fr")}>
                      {cardFilters}
                    </div>
                  </Collapse>
                ) : null}
              </div>
            </Collapse>
          ) : null}
          {children}
        </CommandCenterContainer>
      </div>
    </div>
  );
}

const OPEN = "grid-rows-[1fr]";
const CLOSED = "invisible grid-rows-[0fr]";

/**
 * Opens and closes its content by height instead of jumping. While closed it is
 * hidden from focus and screen readers; the clip margin keeps focus rings whole.
 */
function Collapse({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={cn("grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none", className)}>
      <div className="min-h-0 overflow-clip [overflow-clip-margin:4px]">{children}</div>
    </div>
  );
}

/**
 * The page frame, empty, with the list spinner in its card: what a page shows
 * while it loads, so the bar and card are already in place when the content
 * arrives and nothing jumps.
 */
export function PageFrameLoading({ label }: { label: string }) {
  return (
    <LibraryPageShell icon={null} title="">
      <ListLoading label={label} />
    </LibraryPageShell>
  );
}
