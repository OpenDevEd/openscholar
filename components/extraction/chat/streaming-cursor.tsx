"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Inline blinking block cursor appended to streaming assistant text.
 * Matches the Claude / ChatGPT pattern. Honors prefers-reduced-motion
 * by holding the cursor solid instead of animating opacity.
 */
export function StreamingCursor() {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      data-testid="streaming-cursor"
      className="ml-0.5 inline-block h-[1em] w-[0.5ch] translate-y-[0.15em] rounded-[1px] bg-foreground align-middle"
      initial={{ opacity: 1 }}
      animate={
        reduceMotion ? { opacity: 1 } : { opacity: [1, 0, 1] }
      }
      transition={
        reduceMotion
          ? undefined
          : {
              duration: 1,
              repeat: Number.POSITIVE_INFINITY,
              ease: "linear",
              times: [0, 0.5, 1],
            }
      }
    />
  );
}
