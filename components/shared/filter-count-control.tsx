"use client";

import { motion } from "motion/react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hoverSpring } from "@/lib/ui/sidebar-motion";
import { cn } from "@/lib/utils";

/** How many filters are on, with one button to clear them all. */
export function FilterCountControl({
  count,
  onClearAll,
  orientation = "row",
}: {
  count: number;
  onClearAll: () => void;
  orientation?: "row" | "column";
}) {
  const t = useTranslations("sidebarLayout");
  const column = orientation === "column";
  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.95, opacity: 0 }}
      transition={{ duration: 0.15, delay: column ? 0.1 : 0 }}
      className={cn("flex items-center", column ? "flex-col gap-2" : "gap-1")}
    >
      <span
        className={cn(
          "flex items-center justify-center h-7 text-xs font-medium rounded-md bg-gradient-to-r from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)] text-white badge-glow",
          column ? "w-7" : "min-w-7 px-2",
        )}
      >
        {count}
      </span>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} transition={hoverSpring}>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClearAll}
              aria-label={t("clearAllFilters")}
              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side={column ? "left" : "bottom"}>{t("clearAllFilters")}</TooltipContent>
      </Tooltip>
    </motion.div>
  );
}
