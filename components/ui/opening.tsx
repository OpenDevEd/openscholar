"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The app's easing for what opens and moves. */
export const EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Something that opens its place as it comes, and closes it as it goes: a rail section, or a part
 * of a card that's read after the card has opened. What is already there when its card opens is
 * `instant`: simply there. That says so for this part only, where an `AnimatePresence` with
 * `initial={false}` would also stop what's inside it from animating in. `across` opens it in a
 * row, by its width.
 */
export function Opening({ instant = false, across = false, className, children }: { instant?: boolean; across?: boolean; className?: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const size = across ? "width" : "height";
  return (
    <motion.div
      className={cn(across ? "shrink-0 overflow-hidden" : "w-full overflow-hidden", className)}
      initial={instant ? false : reduceMotion ? { opacity: 0 } : { [size]: 0, opacity: 0 }}
      animate={{ [size]: "auto", opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { [size]: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
