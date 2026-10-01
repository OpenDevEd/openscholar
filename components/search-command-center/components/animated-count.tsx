"use client";

import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter } from "next-intl";
import { cn } from "@/lib/utils";

interface AnimatedCountProps {
  value: number;
  /** The value is a lower bound: shown as "1,000+". */
  atLeast?: boolean;
  className?: string;
}

export function AnimatedCount({ value, atLeast = false, className }: AnimatedCountProps) {
  const format = useFormatter();
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={`${value}${atLeast ? "+" : ""}`}
          initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
          transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          className="inline-block tabular-nums"
        >
          {format.number(value)}
          {atLeast && "+"}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
