"use client";

import { MobileSidebarTrigger } from "./app-sidebar";
import { useIsMobile } from "@/lib/hooks";
import { Logo } from "./logo";

export function MobileNavbar() {
  const isMobile = useIsMobile();
  
  if (!isMobile) return null;
  
  return (
    <header className="lg:hidden sticky top-0 z-50 flex items-center justify-between gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 h-14 shrink-0">
      <div className="flex items-center gap-3">
        <MobileSidebarTrigger />
        <Logo size="sm" context="general" clickable={true} />
      </div>
    </header>
  );
}
