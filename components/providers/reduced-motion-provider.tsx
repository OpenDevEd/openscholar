"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Globally opts the app into the user's OS-level `prefers-reduced-motion` setting.
 * When the OS signals "reduce motion", Motion/Framer Motion disables transform +
 * layout animations everywhere (opacity + backgroundColor transitions remain).
 *
 * Placed INSIDE NextIntlClientProvider so every client subtree that renders
 * motion.div or calls useReducedMotion() inherits the config.
 *
 * Phase 105 D-18.
 */
export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
