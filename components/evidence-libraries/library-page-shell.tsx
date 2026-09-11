"use client";

import { Layers, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { StickyPageHeader } from "@/components/layout/sticky-page-header";
import { PanelHeader } from "./configuration/panel-header";

/**
 * The page frame every Evidence Library page shares: a sticky header bar with
 * the icon tile, title, optional back chevron and actions, then one elevated
 * card holding the page content.
 */
export function LibraryPageShell({
  icon = Layers,
  image,
  title,
  description,
  backHref,
  backLabel,
  titleAside,
  actions,
  children,
}: {
  icon?: LucideIcon;
  image?: string | null;
  title: ReactNode;
  description?: ReactNode;
  backHref?: string;
  backLabel?: string;
  titleAside?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full pb-16">
      <StickyPageHeader>
        <PanelHeader
          icon={icon}
          image={image}
          className="border-b-0 px-0 md:px-0"
          title={title}
          description={description}
          backHref={backHref}
          backLabel={backLabel}
          titleAside={titleAside}
        >
          {actions}
        </PanelHeader>
      </StickyPageHeader>

      <div className="container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer>{children}</CommandCenterContainer>
      </div>
    </div>
  );
}
