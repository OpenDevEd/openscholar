"use client";

import type { ReactNode } from "react";
import { StickyPageHeader } from "@/components/layout/sticky-page-header";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";

/** Shared geometry for library configuration and author profile settings. */
export function ConfigurationLayout({
  header,
  navigation,
  children,
  footer,
}: {
  header: ReactNode;
  navigation: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="w-full pb-16 [--configuration-offset:calc(var(--app-navbar-height)+var(--page-header-height,6rem)+1rem)] [&_section[id^=sec-]]:scroll-mt-[var(--configuration-offset)]">
      <StickyPageHeader>{header}</StickyPageHeader>
      <div className="@container/configuration container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer
          allowOverflow
          className="flex flex-col @min-[42rem]/configuration:flex-row"
        >
          <aside className="w-full border-b border-border/40 bg-muted/20 @min-[42rem]/configuration:w-60 @min-[42rem]/configuration:shrink-0 @min-[42rem]/configuration:border-b-0 @min-[42rem]/configuration:border-r @min-[42rem]/configuration:bg-transparent">
            {navigation}
          </aside>
          <div className="min-w-0 flex-1 space-y-4 p-4 @min-[42rem]/configuration:p-6">{children}</div>
        </CommandCenterContainer>
      </div>
      {footer}
    </div>
  );
}

export function ConfigurationNavigation({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className="space-y-5 p-4 @min-[42rem]/configuration:sticky @min-[42rem]/configuration:top-[var(--configuration-offset)] @min-[42rem]/configuration:max-h-[calc(100dvh-var(--configuration-offset)-1rem)] @min-[42rem]/configuration:overflow-y-auto @min-[42rem]/configuration:p-5"
    >
      {children}
    </nav>
  );
}
