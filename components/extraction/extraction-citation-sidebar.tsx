"use client";

import { FileSearch } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PdfCitationPanel } from "@/components/extraction/pdf-citation-panel";
import type { CitationPanelPayload } from "@/lib/extraction/citation-panel";
import {
  useExtractionCitationPanelStore,
  getExtractionCitationPanelDimensions,
} from "@/lib/store";
import { sidebarSpring, hoverSpring } from "@/lib/ui/sidebar-motion";

type ExtractionCitationSidebarProps = {
  panelPayload: CitationPanelPayload | null;
};

export function ExtractionCitationSidebar({
  panelPayload,
}: ExtractionCitationSidebarProps) {
  const t = useTranslations();
  const { isCollapsed, setCollapsed, toggle, _hasHydrated } =
    useExtractionCitationPanelStore();
  const { expandedWidth, collapsedWidth } =
    getExtractionCitationPanelDimensions(isCollapsed);

  if (!_hasHydrated) return null;

  const hasPayload = panelPayload !== null;
  const width = !hasPayload ? 0 : isCollapsed ? collapsedWidth : expandedWidth;
  const translateX = isCollapsed ? -(expandedWidth - collapsedWidth) : 0;

  return (
    <div
      className="h-full relative overflow-hidden"
      style={{
        width,
        transition: `width ${sidebarSpring.stiffness}ms ease-out`,
      }}
    >
      <motion.aside
        className={cn(
          "h-full flex flex-col overflow-hidden absolute right-0 top-0 bottom-0",
          "bg-background/80 dark:bg-background/60",
          "backdrop-blur-xl backdrop-saturate-150",
          "border-l border-border/50",
        )}
        initial={false}
        animate={{ x: translateX }}
        transition={sidebarSpring}
        style={{ width: expandedWidth }}
      >
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />

        {/* Floating controls — expanded state */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-background/60 backdrop-blur-sm rounded-lg p-1 border border-border/30">
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

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-hidden p-2">
          <PdfCitationPanel key={`${panelPayload?.paperId ?? ""}-${panelPayload?.questionText ?? ""}`} payload={panelPayload} />
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
            {panelPayload?.citations?.[0]?.page != null && (
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.15, delay: 0.1 }}
              >
                <span className="flex items-center justify-center h-7 min-w-7 px-2 text-xs font-medium rounded-md bg-primary/15 text-primary border border-primary/20">
                  p.{panelPayload.citations[0].page}
                </span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
