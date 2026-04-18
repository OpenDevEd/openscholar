"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  total: number;
  tint?: string;
  /**
   * Extra classes for the outer span — callers pass size/alignment
   * tweaks (e.g. `text-xs` or `text-sm`) without having to replicate
   * the base `font-semibold tabular-nums` styling.
   */
  className?: string;
  /**
   * Render the `/ total` suffix. Defaults to true. Pass `false` in
   * the collapsed sliver where 48 px of horizontal space can't fit
   * "N / total".
   */
  showTotal?: boolean;
};

export function AnimatedCount({
  value,
  total,
  tint,
  className,
  showTotal = true,
}: Props) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return (
      <span
        className={cn(
          "inline-flex items-baseline gap-1 font-semibold tabular-nums",
          tint,
          className,
        )}
      >
        <span>{value}</span>
        {showTotal && (
          <span className="font-medium text-muted-foreground">/ {total}</span>
        )}
      </span>
    );
  }

  return (
    <motion.span
      key={`pulse-${value}`}
      className={cn(
        "inline-flex items-baseline gap-1 font-semibold tabular-nums",
        tint,
        className,
      )}
      animate={{ scale: [1, 1.15, 1] }}
      transition={{
        duration: 0.3,
        times: [0, 0.5, 1],
        ease: [0.4, 0, 0.2, 1],
      }}
    >
      <span className="relative inline-block overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={value}
            className="inline-block"
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      {showTotal && (
        <span className="font-medium text-muted-foreground">/ {total}</span>
      )}
    </motion.span>
  );
}
