"use client";

import { MobileSidebarTrigger } from "./app-sidebar";
import { usePathname } from "next/navigation";
import { Logo } from "./logo";

const CHROMELESS_ROUTES = ["/connect", "/sign-in", "/sign-up"];

export function MobileNavbar() {
  const pathname = usePathname();

  // Shown by the stylesheet alone (`md:hidden`), so it is in the page's first frame on a phone: waiting for the
  // script to measure the screen put it in late, and pushed the page down by its height.
  if (CHROMELESS_ROUTES.some((r) => pathname?.startsWith(r))) return null;

  return (
    <header className="md:hidden sticky top-8 z-50 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-4">
      {/* The bar counts in rem, so at large text the mark stays and the name goes to screen readers. */}
      <div className="@container min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <MobileSidebarTrigger />
          <Logo size="sm" context="general" clickable={true} nameClassName="@max-[12.5rem]:sr-only" />
        </div>
      </div>
    </header>
  );
}
