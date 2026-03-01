"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { sidebarSpring, hoverSpring } from "@/lib/ui/sidebar-motion";
import { useTranslations } from "next-intl";
import { useIsMobile } from "@/lib/hooks";
import type { StoreApi } from "zustand";
import type { UseBoundStore } from "zustand";

/**
 * State shape for sidebar collapse stores.
 * Matches the FilterSidebarState interface in lib/store.ts.
 */
interface FilterSidebarState {
  isCollapsed: boolean;
  _hasHydrated: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
  setHasHydrated: (state: boolean) => void;
}

export interface FilterSidebarProps {
  /** Page-specific filter content rendered in the scrollable area */
  children: React.ReactNode;
  /** Number of active filters -- drives badge display */
  activeFilterCount: number;
  /** Called when user clicks the clear button */
  onClearAll: () => void;
  /** Zustand store hook for collapse state (from createSidebarStore) */
  useStore: UseBoundStore<StoreApi<FilterSidebarState>>;
  /** Dimension calculator (from createSidebarDimensions or getFilterSidebarDimensions) */
  getDimensions: (isCollapsed: boolean) => {
    expandedWidth: number;
    collapsedWidth: number;
    currentWidth: number;
  };
}

/**
 * Generic sidebar chrome shell.
 *
 * Provides the visual sidebar frame (glassmorphic background, collapse animation,
 * floating controls with badge/clear/toggle, scrollable content area) without
 * any knowledge of specific filters. Page-specific filter content is passed
 * via `children`.
 */
export function FilterSidebar({
  children,
  activeFilterCount,
  onClearAll,
  useStore,
  getDimensions,
}: FilterSidebarProps) {
  const { isCollapsed, _hasHydrated, toggle } = useStore();
  const { expandedWidth, collapsedWidth } = getDimensions(isCollapsed);
  const t = useTranslations("sidebarLayout");
  const isMobileView = useIsMobile();

  // Keyboard shortcut: Ctrl+Shift+F (or Cmd+Shift+F) to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  // Don't render until hydrated or on mobile
  if (!_hasHydrated || isMobileView) return null;

  // Calculate translateX - when collapsed, slide left so only collapsedWidth is visible
  const translateX = isCollapsed ? -(expandedWidth - collapsedWidth) : 0;

  return (
    <div
      className="h-full relative"
      style={{
        width: isCollapsed ? collapsedWidth : expandedWidth,
        transition: `width ${sidebarSpring.stiffness}ms ease-out`,
      }}
    >
      {/* Sidebar that translates */}
      <motion.aside
        className={cn(
          "h-full flex flex-col overflow-hidden absolute right-0 top-0 bottom-0",
          "bg-background/80 dark:bg-background/60",
          "backdrop-blur-xl backdrop-saturate-150",
          "border-l border-border/50"
        )}
        initial={false}
        animate={{ x: translateX }}
        transition={sidebarSpring}
        style={{ width: expandedWidth }}
      >
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />

        {/* Floating controls in top-right corner */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-background/60 backdrop-blur-sm rounded-lg p-1 border border-border/30">
          <AnimatePresence>
            {activeFilterCount > 0 && (
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-1"
              >
                <span className="flex items-center justify-center h-7 min-w-7 px-2 text-xs font-medium rounded-md bg-gradient-to-r from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)] text-white badge-glow">
                  {activeFilterCount}
                </span>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      transition={hoverSpring}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClearAll}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </motion.div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t("clearAllFilters")}
                  </TooltipContent>
                </Tooltip>
              </motion.div>
            )}
          </AnimatePresence>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={hoverSpring}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggle}
                  className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 transition-all duration-200"
                >
                  <motion.div
                    animate={{ rotate: 0 }}
                    whileHover={{ rotate: isCollapsed ? 90 : -90 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Filter className="h-4 w-4" />
                  </motion.div>
                </Button>
              </motion.div>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isCollapsed ? t("expandFilters") : t("collapseFilters")}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Scrollable content with hidden scrollbar */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {children}
        </div>
      </motion.aside>

      {/* Fixed controls that stay visible when collapsed */}
      <AnimatePresence>
        {isCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute top-4 right-0 z-20 flex flex-col items-center gap-2"
          >
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={hoverSpring}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggle}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 transition-all duration-200"
                  >
                    <motion.div
                      animate={{ rotate: 0 }}
                      whileHover={{ rotate: 90 }}
                      transition={{ duration: 0.3 }}
                    >
                      <Filter className="h-4 w-4" />
                    </motion.div>
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent side="left">
                {t("expandFilters")}
              </TooltipContent>
            </Tooltip>

            {/* Filter count badge and clear button */}
            {activeFilterCount > 0 && (
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15, delay: 0.1 }}
                className="flex flex-col items-center gap-2"
              >
                <span className="flex items-center justify-center h-7 w-7 text-xs font-medium rounded-md bg-gradient-to-r from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)] text-white badge-glow">
                  {activeFilterCount}
                </span>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      transition={hoverSpring}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClearAll}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </motion.div>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {t("clearAllFilters")}
                  </TooltipContent>
                </Tooltip>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
