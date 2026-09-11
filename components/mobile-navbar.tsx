"use client";

import { MobileSidebarTrigger } from "./app-sidebar";
import { useIsMobile } from "@/lib/hooks";
import { usePathname } from "next/navigation";
import { Logo } from "./logo";

const CHROMELESS_ROUTES = ["/connect", "/sign-in", "/sign-up"];

export function MobileNavbar() {
  const isMobile = useIsMobile();
  const pathname = usePathname();

  if (!isMobile) return null;
  if (CHROMELESS_ROUTES.some((r) => pathname?.startsWith(r))) return null;

  return (
    <header className="md:hidden sticky top-0 z-50 flex h-[var(--app-navbar-height)] shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-4">
      <div className="flex items-center gap-3">
        <MobileSidebarTrigger />
        <Logo size="sm" context="general" clickable={true} />
      </div>
    </header>
  );
}
