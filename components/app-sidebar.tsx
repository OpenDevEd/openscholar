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
import type { FirstWorkspace } from "@/lib/workspaces/look-cache";

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

/** `firstWorkspace`: the workspace the page was asked for, and how it looked last time, so the rail is drawn as it from the first frame. */
export function AppSidebar({ firstWorkspace }: { firstWorkspace: FirstWorkspace }) {
  const tLabels = useTranslations("sharedControls");
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
          <SheetTitle className="sr-only">{tLabels("navigation")}</SheetTitle>
          <Suspense fallback={null}>
            <SidebarContent firstWorkspace={firstWorkspace} onClose={() => setOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside className="sticky start-0 top-0 z-40 hidden h-screen w-20 shrink-0 border-e border-sidebar-border bg-sidebar md:block">
      <Suspense fallback={null}>
        <SidebarContent firstWorkspace={firstWorkspace} />
      </Suspense>
    </aside>
  );
}

export function MobileSidebarTrigger() {
  const t = useTranslations("accessibility");
  const isOpen = useSidebarStore((s) => s.isOpen);
  const setOpen = useSidebarStore((s) => s.setOpen);

  // Its only place is the phone's bar, which the stylesheet shows and hides: it is there from the bar's first frame.
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
