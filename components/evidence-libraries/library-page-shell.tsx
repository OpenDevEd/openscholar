"use client";

import { Layers, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { StickyPageHeader } from "@/components/layout/sticky-page-header";
import { cn } from "@/lib/utils";
import { PanelHeader } from "./configuration/panel-header";

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
  children,
}: {
  icon?: LucideIcon;
  image?: string | null;
  title: string;
  backHref?: string;
  backLabel?: string;
  titleAside?: ReactNode;
  tabs?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  /** The top of a detail page's card. Its filters then always sit with the list below it. */
  intro?: ReactNode;
  children: ReactNode;
}) {
  const filtersInBar = !intro && filters;
  const cardToolbar = intro && filters ? "" : filtersInBar ? "@6xl:hidden" : tabs ? "@3xl:hidden" : "hidden";
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
          {tabs || filters ? (
            <div className={cn("flex flex-wrap items-center gap-3 border-b border-border/50 p-4", cardToolbar)}>
              {tabs ? <div className="-mx-1 max-w-full overflow-x-auto px-1 @3xl:hidden">{tabs}</div> : null}
              {/* Filters share a row in equal columns, go two by two on a tablet and stack on a phone. */}
              {filters ? (
                <div className={cn("grid w-full gap-2 [&>*]:w-full [&>:only-child]:col-span-full [&_input]:w-full", intro ? "@3xl:ml-auto @3xl:w-64" : "@lg:grid-cols-2 @3xl:grid-flow-col @3xl:grid-cols-none @3xl:auto-cols-fr")}>
                  {filters}
                </div>
              ) : null}
            </div>
          ) : null}
          {children}
        </CommandCenterContainer>
      </div>
    </div>
  );
}
