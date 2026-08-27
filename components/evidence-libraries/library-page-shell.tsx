"use client";

import { Layers, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { PanelHeader } from "./configuration/panel-header";

/**
 * The page frame every Evidence Library page shares: a sticky header bar with
 * the icon tile, title, optional back chevron and actions, then one elevated
 * card holding the page content.
 */
export function LibraryPageShell({
  icon = Layers,
  title,
  description,
  eyebrow,
  backHref,
  backLabel,
  titleAside,
  actions,
  children,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  backHref?: string;
  backLabel?: string;
  titleAside?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full pb-16">
      <div className="sticky top-14 z-20 border-b border-border/40 bg-background lg:top-0">
        <div className="container mx-auto max-w-6xl px-4 sm:px-6">
          <PanelHeader
            icon={icon}
            className="border-b-0 px-0 md:px-0"
            title={title}
            description={description}
            eyebrow={eyebrow}
            backHref={backHref}
            backLabel={backLabel}
            titleAside={titleAside}
          >
            {actions}
          </PanelHeader>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer>{children}</CommandCenterContainer>
      </div>
    </div>
  );
}
