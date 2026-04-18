"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  total: number;
  tint?: string;
  /**
   * Visual scale of the count text. Used to render a compact variant in
   * the collapsed sliver (vertical layout) vs. the panel header.
   */
  className?: string;
};

export function AnimatedCount({ value, total, tint, className }: Props) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return (
      <span
        className={cn(
          "inline-flex items-baseline gap-1 font-medium tabular-nums",
          tint,
          className,
        )}
      >
        <span>{value}</span>
        <span className="text-muted-foreground">/ {total}</span>
      </span>
    );
  }

  return (
    <motion.span
      key={`pulse-${value}`}
      className={cn(
        "inline-flex items-baseline gap-1 font-medium tabular-nums",
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
      <span className="relative inline-block overflow-hidden leading-none">
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
      <span className="text-muted-foreground">/ {total}</span>
    </motion.span>
  );
}
