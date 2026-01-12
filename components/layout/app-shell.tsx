"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { MobileSidebarTrigger } from "@/components/app-sidebar";
import { PageWrapper } from "@/components/PageWrapper";

interface AppShellProps {
  children: React.ReactNode;
  className?: string;
}

export function AppShell({ children, className }: AppShellProps) {
  return (
    <PageWrapper removeOverflow={true}>
      <div className="flex flex-col min-h-0">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 h-14 shrink-0">
          <MobileSidebarTrigger />
          <span className="font-semibold text-foreground">OpenScholar</span>
        </header>

        {/* Page Content - overflow handled by children */}
        <div className={cn("flex-1 min-h-0 overflow-hidden", className)}>
          {children}
        </div>
      </div>
    </PageWrapper>
  );
}
