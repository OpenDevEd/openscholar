"use client";

import React from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export interface FilterSectionProps {
  title: string;
  icon: React.ElementType;
  isActive: boolean;
  children: React.ReactNode;
  onClear?: () => void;
}

export const FilterSection = React.memo(function FilterSection({
  title,
  icon: Icon,
  isActive,
  children,
  onClear,
}: FilterSectionProps) {
  const tc = useTranslations("common");
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "relative rounded-xl overflow-hidden transition-all duration-200",
        "border",
        isActive
          ? "bg-sidebar-accent/80 border-border/60"
          : "bg-card/50 dark:bg-card/40 border-border/40 hover:border-border/60"
      )}
    >
      {/* Active indicator - left gradient bar */}
      {isActive && (
        <motion.div
          initial={false}
          animate={{ scaleY: 1 }}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] rounded-r-sm bg-gradient-to-b from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)]"
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              "h-4 w-4 transition-colors duration-200",
              isActive ? "text-sidebar-primary" : "text-muted-foreground"
            )}
          />
          <span
            className={cn(
              "text-sm font-medium transition-colors duration-200",
              isActive ? "text-sidebar-primary" : "text-foreground"
            )}
          >
            {title}
          </span>
        </div>
        {isActive && onClear && (
          <motion.div
            initial={false}
            animate={{ opacity: 1, scale: 1 }}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80"
            >
              <X className="h-3 w-3 mr-1" />
              {tc("clear")}
            </Button>
          </motion.div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pb-4">{children}</div>
    </motion.div>
  );
});
