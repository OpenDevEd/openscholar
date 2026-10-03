"use client";

import { FileSearch } from "@/components/icons";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AnswerPanel, openAnswerKey, type OpenAnswer } from "@/components/extraction/answer-panel";
import { getAllCitationLocations } from "@/lib/extraction/citations";
import {
  useExtractionCitationPanelStore,
  getExtractionCitationPanelDimensions,
} from "@/lib/store";
import { sidebarSpring, hoverSpring } from "@/lib/ui/sidebar-motion";

type ExtractionCitationSidebarProps = {
  answer: OpenAnswer | null;
};

export function ExtractionCitationSidebar({
  answer,
}: ExtractionCitationSidebarProps) {
  const t = useTranslations();
  const { isCollapsed, setCollapsed, toggle, _hasHydrated } =
    useExtractionCitationPanelStore();
  const { expandedWidth, collapsedWidth } =
    getExtractionCitationPanelDimensions(isCollapsed);

  if (!_hasHydrated) return null;

  const hasPayload = answer !== null;
  const firstPage = getAllCitationLocations(answer?.result)[0]?.page;
  const width = !hasPayload ? 0 : isCollapsed ? collapsedWidth : expandedWidth;
  const translateX = isCollapsed ? -(expandedWidth - collapsedWidth) : 0;

  return (
    <div
      className="h-full relative overflow-hidden"
      style={{
        width,
        // Quick, so an opened answer shows at once.
        transition: "width 180ms ease-out",
      }}
    >
      {/* The same line across the collapsed strip, where the panel itself has slid away. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-16 h-px bg-sidebar-border/50" />
      <motion.aside
        className={cn(
          "h-full flex flex-col overflow-hidden absolute right-0 top-0 bottom-0",
          "bg-background/95 dark:bg-background/90",
          "border-l border-border/50",
        )}
        initial={false}
        animate={{ x: translateX }}
        transition={sidebarSpring}
        style={{ width: expandedWidth }}
      >
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />

        {/* The page bar's bottom line runs on under the panel, so the panel floats above it. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-16 h-px bg-sidebar-border/50" />

        {/* Floating controls — expanded state */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-border/30 bg-background/95 p-1">
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
                  onClick={() => setCollapsed(true)}
                  className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 transition-all duration-200"
                  aria-label={t("accessibility.collapsePanel")}
                >
                  <motion.div
                    animate={{ rotate: 0 }}
                    whileHover={{ rotate: -90 }}
                    transition={{ duration: 0.3 }}
                  >
                    <FileSearch className="h-4 w-4" />
                  </motion.div>
                </Button>
              </motion.div>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("accessibility.collapsePanel")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Scrollable content, above the line */}
        <div className="relative flex-1 min-h-0 overflow-hidden p-2">
          <AnswerPanel key={openAnswerKey(answer) ?? ""} answer={answer} />
        </div>
      </motion.aside>

      {/* Collapsed strip controls */}
      <AnimatePresence>
        {isCollapsed && hasPayload && (
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
                    aria-label={t("accessibility.expandPanel")}
                  >
                    <motion.div
                      animate={{ rotate: 0 }}
                      whileHover={{ rotate: 90 }}
                      transition={{ duration: 0.3 }}
                    >
                      <FileSearch className="h-4 w-4" />
                    </motion.div>
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent side="left">{t("accessibility.expandPanel")}</TooltipContent>
            </Tooltip>

            {/* Page number badge */}
            {firstPage != null && (
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15, delay: 0.1 }}
              >
                <span className="flex items-center justify-center h-7 min-w-7 px-2 text-xs font-medium rounded-md bg-primary/15 text-primary border border-primary/20">
                  p.{firstPage}
                </span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
