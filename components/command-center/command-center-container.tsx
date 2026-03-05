"use client";

import React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";

interface CommandCenterContainerProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Shared elevated container for command centers (bookmarks, history, search).
 * Provides consistent styling with a subtle gradient overlay.
 */
export function CommandCenterContainer({
  children,
  className,
}: CommandCenterContainerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={subtleSpring}
      className={cn(
        "relative rounded-2xl overflow-hidden",
        "bg-background/95 dark:bg-background/90",
        "border border-border/50",
        "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
        className
      )}
    >
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />
      {children}
    </motion.div>
  );
}
