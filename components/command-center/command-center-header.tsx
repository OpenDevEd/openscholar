"use client";

import React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { subtleSpring } from "@/lib/animation-config";
import type { LucideIcon } from "lucide-react";

interface CommandCenterHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  count: number;
  singular: string;
  plural: string;
  countLabel?: string;
}

/**
 * Shared header component for command centers.
 * Displays icon, title, description, and count badge.
 */
export function CommandCenterHeader({
  icon: Icon,
  title,
  description,
  count,
  singular,
  plural,
  countLabel,
}: CommandCenterHeaderProps) {
  return (
    <div
      className={cn(
        "relative px-4 md:px-6 py-5",
        "border-b border-border/40"
      )}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: Icon + Title */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...subtleSpring, delay: 0.05 }}
          className="flex items-center gap-3 md:gap-4"
        >
          {/* Gradient icon circle */}
          <div className="relative">
            <div
              className={cn(
                "w-10 h-10 md:w-12 md:h-12 rounded-xl",
                "bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10",
                "flex items-center justify-center",
                "shadow-sm"
              )}
            >
              <Icon className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            </div>
            {/* Subtle glow effect */}
            <div className="absolute inset-0 rounded-xl bg-primary/10 blur-xl -z-10" />
          </div>

          {/* Title + Description */}
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-foreground">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground hidden sm:block">
              {description}
            </p>
          </div>
        </motion.div>

        {/* Right: Stats badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...subtleSpring, delay: 0.1 }}
        >
          <div
            className={cn(
              "px-3 py-1.5 rounded-full",
              "bg-muted/60 dark:bg-muted/40",
              "border border-border/50",
              "flex items-center gap-1.5"
            )}
          >
            {countLabel ? (
              <motion.span
                key={count}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={subtleSpring}
                className="text-sm font-semibold text-foreground tabular-nums"
              >
                {countLabel}
              </motion.span>
            ) : (
              <>
                <motion.span
                  key={count}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={subtleSpring}
                  className="text-sm font-semibold text-foreground tabular-nums"
                >
                  {count}
                </motion.span>
                <span className="text-sm text-muted-foreground">
                  {count === 1 ? singular : plural}
                </span>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
