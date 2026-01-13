"use client";

import React from "react";
import { motion } from "framer-motion";
import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CommandCenterMode } from "../index";

const tabSpring = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30,
  mass: 0.8,
};

interface ModeTabsProps {
  mode: CommandCenterMode;
  onChange: (mode: CommandCenterMode) => void;
  disabled?: boolean;
}

const tabs: { id: CommandCenterMode; label: string; icon: typeof Search }[] = [
  { id: "search", label: "Search", icon: Search },
  { id: "adjust", label: "Adjust", icon: SlidersHorizontal },
];

export function ModeTabs({ mode, onChange, disabled }: ModeTabsProps) {
  return (
    <div className="relative flex bg-muted/50 rounded-lg p-1 gap-0.5">
      {tabs.map((tab) => {
        const isActive = mode === tab.id;
        const Icon = tab.icon;

        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            disabled={disabled}
            className={cn(
              "relative z-10 flex items-center gap-1.5 px-3 py-1.5",
              "text-sm font-medium rounded-md",
              "transition-colors duration-200",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            {isActive && (
              <motion.div
                layoutId="mode-tab-indicator"
                className={cn(
                  "absolute inset-0 rounded-md",
                  "bg-background shadow-sm",
                  "border border-border/50"
                )}
                transition={tabSpring}
              />
            )}
            <Icon className="relative z-10 h-4 w-4" />
            <span className="relative z-10 hidden sm:inline">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
