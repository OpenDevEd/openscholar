"use client";

import type { ReactNode } from "react";
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
    <div className="w-full pb-16">
      <div className="sticky top-14 z-20 border-b border-border/40 bg-background lg:top-0">
        <div className="container mx-auto max-w-6xl px-4 sm:px-6">{header}</div>
      </div>
      <div className="container mx-auto max-w-6xl p-4 sm:p-6">
        <CommandCenterContainer
          allowOverflow
          className="flex flex-col md:flex-row"
        >
          <aside className="w-full border-b border-border/40 bg-muted/20 md:w-60 md:border-b-0 md:border-r md:bg-transparent">
            {navigation}
          </aside>
          <div className="min-w-0 flex-1 space-y-4 p-4 md:p-6">{children}</div>
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
      className="space-y-5 p-4 md:sticky md:top-24 md:max-h-[calc(100vh-7rem)] md:overflow-y-auto md:p-5"
    >
      {children}
    </nav>
  );
}
