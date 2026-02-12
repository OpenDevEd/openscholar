"use client";

import React from "react";
import { List, LayoutList, LayoutGrid, Grid3X3 } from "lucide-react";
import { useUIStore } from "@/lib/store";
import { ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface ViewModeOption {
  mode: ViewMode;
  icon: React.ReactNode;
  label: string;
  shortLabel: string;
}

// Compact version for tight spaces
export function ViewModeToggleCompact() {
  const { viewMode, setViewMode } = useUIStore();
  const t = useTranslations("viewMode");

  const viewModeOptions: ViewModeOption[] = [
    { mode: "list-simple", icon: <List className="h-4 w-4" />, label: t("simpleList"), shortLabel: t("simple") },
    { mode: "list-detail", icon: <LayoutList className="h-4 w-4" />, label: t("detailedList"), shortLabel: t("detail") },
    { mode: "grid-2", icon: <LayoutGrid className="h-4 w-4" />, label: t("twoColumnGrid"), shortLabel: "2×2" },
    { mode: "grid-3", icon: <Grid3X3 className="h-4 w-4" />, label: t("threeColumnGrid"), shortLabel: "3×3" },
  ];

  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-muted/50 dark:bg-muted/30 rounded-lg border border-border/60">
      {viewModeOptions.map((option) => {
        const isActive = viewMode === option.mode;
        
        return (
          <button
            key={option.mode}
            onClick={() => setViewMode(option.mode)}
            className={cn(
              "relative z-10 flex items-center justify-center p-1.5 rounded-md transition-colors",
              isActive
                ? "text-primary bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
            title={option.label}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
