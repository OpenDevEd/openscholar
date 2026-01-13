"use client";

import React from "react";
import { motion } from "framer-motion";
import { List, LayoutList, LayoutGrid, Grid3X3 } from "lucide-react";
import { useUIStore, ViewMode } from "@/lib/store";
import { cn } from "@/lib/utils";

interface ViewModeOption {
  mode: ViewMode;
  icon: React.ReactNode;
  label: string;
  shortLabel: string;
}

const viewModeOptions: ViewModeOption[] = [
  {
    mode: "list-simple",
    icon: <List className="h-4 w-4" />,
    label: "Simple List",
    shortLabel: "Simple",
  },
  {
    mode: "list-detail",
    icon: <LayoutList className="h-4 w-4" />,
    label: "Detailed List",
    shortLabel: "Detail",
  },
  {
    mode: "grid-2",
    icon: <LayoutGrid className="h-4 w-4" />,
    label: "2 Column Grid",
    shortLabel: "2×2",
  },
  {
    mode: "grid-3",
    icon: <Grid3X3 className="h-4 w-4" />,
    label: "3 Column Grid",
    shortLabel: "3×3",
  },
];

const tabSpring = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30,
  mass: 0.8,
};

export function ViewModeToggle() {
  const { viewMode, setViewMode } = useUIStore();

  return (
    <div className="flex items-center">
      <div className="relative flex items-center gap-0.5 p-1 bg-muted/50 dark:bg-muted/30 rounded-xl border border-border/60">
        {viewModeOptions.map((option) => {
          const isActive = viewMode === option.mode;
          
          return (
            <button
              key={option.mode}
              onClick={() => setViewMode(option.mode)}
              className={cn(
                "relative z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title={option.label}
            >
              {isActive && (
                <motion.div
                  layoutId="viewModeIndicator"
                  className="absolute inset-0 bg-background dark:bg-background/80 rounded-lg shadow-sm border border-border/50"
                  transition={tabSpring}
                  style={{ zIndex: -1 }}
                />
              )}
              {option.icon}
              <span className="hidden @lg:inline">{option.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Compact version for tight spaces
export function ViewModeToggleCompact() {
  const { viewMode, setViewMode } = useUIStore();

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
