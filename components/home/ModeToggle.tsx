"use client";

import { motion, LayoutGroup, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { Search, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { modeToggleSpring } from "@/lib/animation-config";

export type SearchMode = "search" | "research";

interface ModeToggleProps {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  disabled?: boolean;
}

const tapSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 25,
};

export function ModeToggle({ mode, onModeChange, disabled }: ModeToggleProps) {
  const t = useTranslations("home");
  const shouldReduceMotion = useReducedMotion();

  const indicatorTransition = shouldReduceMotion
    ? { duration: 0 }
    : modeToggleSpring;

  return (
    <LayoutGroup id="home-mode">
      <motion.div
        layout
        className="relative flex flex-nowrap rounded-full border border-border/50 bg-muted/70 p-1"
        transition={indicatorTransition}
      >
        <div className="absolute inset-0 bg-background/50 rounded-full shadow-inner pointer-events-none" />

        <motion.button
          type="button"
          onClick={() => onModeChange("search")}
          disabled={disabled}
          whileHover={disabled ? undefined : { scale: 1.02 }}
          whileTap={disabled ? undefined : { scale: 0.98 }}
          transition={tapSpring}
          className={cn(
            "flex-1 shrink-0 relative z-20 flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap",
            "transition-colors duration-300 ease-out",
            mode === "search"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground/80",
          )}
        >
          {mode === "search" && (
            <motion.div
              layoutId="home-mode-indicator"
              className="absolute inset-0 rounded-full bg-background shadow-sm border border-border/50 z-10"
              transition={indicatorTransition}
            />
          )}
          <Search className="relative z-10 h-4 w-4" />
          <span className="relative z-10">{t("searchMode")}</span>
        </motion.button>

        <motion.button
          type="button"
          onClick={() => onModeChange("research")}
          disabled={disabled}
          whileHover={disabled ? undefined : { scale: 1.02 }}
          whileTap={disabled ? undefined : { scale: 0.98 }}
          transition={tapSpring}
          className={cn(
            "flex-1 shrink-0 relative z-20 flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap",
            "transition-colors duration-300 ease-out",
            mode === "research"
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground/80",
          )}
        >
          {mode === "research" && (
            <motion.div
              layoutId="home-mode-indicator"
              className="absolute inset-0 rounded-full bg-background shadow-sm border border-border/50 z-10"
              transition={indicatorTransition}
            />
          )}
          <Wand2 className="relative z-10 h-4 w-4" />
          <span className="relative z-10">{t("researchMode")}</span>
        </motion.button>
      </motion.div>
    </LayoutGroup>
  );
}
