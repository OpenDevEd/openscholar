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

export interface CompactIconToggleOption<TValue extends string> {
  value: TValue;
  icon: React.ReactNode;
  label: string;
}

interface CompactIconToggleGroupProps<TValue extends string> {
  value: TValue;
  onChange: (value: TValue) => void;
  options: CompactIconToggleOption<TValue>[];
}

export function CompactIconToggleGroup<TValue extends string>({
  value,
  onChange,
  options,
}: CompactIconToggleGroupProps<TValue>) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/50 p-0.5 dark:bg-muted/30">
      {options.map((option) => {
        const isActive = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 flex items-center justify-center rounded-md p-1.5 transition-colors",
              isActive
                ? "bg-background text-primary shadow-sm"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
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
    <CompactIconToggleGroup
      value={viewMode}
      onChange={setViewMode}
      options={viewModeOptions.map((option) => ({
        value: option.mode,
        icon: option.icon,
        label: option.label,
      }))}
    />
  );
}
