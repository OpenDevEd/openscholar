"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Search, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";

export type SearchMode = "search" | "research";

interface ModeToggleProps {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  disabled?: boolean;
}

export function ModeToggle({ mode, onModeChange, disabled }: ModeToggleProps) {
  const t = useTranslations("home");

  return (
    <div className="flex flex-nowrap p-1 bg-muted/50 backdrop-blur-sm rounded-full border border-border/50 relative">
      <div className="absolute inset-0 bg-background/50 rounded-full shadow-inner" />

      {/* Background slide animation */}
      <motion.div
        className="absolute top-1 bottom-1 rounded-full bg-background shadow-sm border border-border/50 z-10"
        initial={false}
        animate={{
          left: mode === "search" ? "4px" : "50%",
          width: "calc(50% - 4px)",
          x: mode === "research" ? "0%" : "0%",
        }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      />

      <button
        type="button"
        onClick={() => onModeChange("search")}
        disabled={disabled}
        className={cn(
          "flex-1 shrink-0 relative z-20 flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 rounded-full text-xs sm:text-sm font-medium transition-colors whitespace-nowrap",
          mode === "search"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground/80",
        )}
      >
        <Search className="w-4 h-4" />
        {t("searchMode")}
      </button>

      <button
        type="button"
        onClick={() => onModeChange("research")}
        disabled={disabled}
        className={cn(
          "flex-1 shrink-0 relative z-20 flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 rounded-full text-xs sm:text-sm font-medium transition-colors whitespace-nowrap",
          mode === "research"
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground/80",
        )}
      >
        <Wand2 className="w-4 h-4" />
        {t("researchMode")}
      </button>
    </div>
  );
}
