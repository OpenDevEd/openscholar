"use client";

import React, { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSidebarStore } from "@/lib/store";
import { useIsMobile } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { PanelLeft } from "@/components/icons";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { SidebarContent } from "@/components/workspaces/rail";

const hoverSpring = { type: "spring" as const, stiffness: 400, damping: 25, mass: 0.6 };

/** Check if the current route should be chromeless (no sidebar).
 *  - /connect is always chromeless
 *  - /sign-in and /sign-up are only chromeless when redirecting to /connect
 */
function useIsChromeless() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (pathname?.startsWith("/connect")) return true;

  if (pathname?.startsWith("/sign-in") || pathname?.startsWith("/sign-up")) {
    const redirect = searchParams.get("redirect_url") ?? "";
    return redirect.startsWith("/connect");
  }

  return false;
}

export function AppSidebar() {
  const isMobile = useIsMobile();
  const { isOpen, setOpen } = useSidebarStore();
  const isChromeless = useIsChromeless();

  // Hide sidebar on chromeless routes (consent flow, auth)
  if (isChromeless) {
    return null;
  }

  // One slim rail at a fixed width that never folds (#651); a phone opens it as a sheet.
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={setOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-20 gap-0 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Suspense fallback={null}>
            <SidebarContent onClose={() => setOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside className="sticky left-0 top-0 z-40 hidden h-screen w-20 shrink-0 border-r border-sidebar-border bg-sidebar md:block">
      <Suspense fallback={null}>
        <SidebarContent />
      </Suspense>
    </aside>
  );
}

export function MobileSidebarTrigger() {
  const isMobile = useIsMobile();
  const t = useTranslations("accessibility");
  const isOpen = useSidebarStore((s) => s.isOpen);
  const setOpen = useSidebarStore((s) => s.setOpen);

  if (!isMobile) return null;

  return (
    <motion.div
      tabIndex={-1}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={hoverSpring}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!isOpen)}
        aria-label={isOpen ? t("collapsePanel") : t("expandPanel")}
        aria-expanded={isOpen}
        className="lg:hidden"
      >
        <PanelLeft className="h-5 w-5" />
      </Button>
    </motion.div>
  );
}
