"use client";

import { motion } from "motion/react";
import { X } from "@/components/icons";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TooltipHint } from "@/components/ui/tooltip";
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
          "flex h-7 items-center justify-center rounded-md bg-primary text-xs font-medium tabular-nums text-primary-foreground",
          column ? "w-7" : "min-w-7 px-2",
        )}
      >
        {count}
      </span>
      <TooltipHint label={t("clearAllFilters")}>
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
      </TooltipHint>
    </motion.div>
  );
}
