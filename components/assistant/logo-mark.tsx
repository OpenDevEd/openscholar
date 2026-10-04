"use client";

// The OpenScholar mark (components/logo.tsx) with its three arcs as separate shapes, so they
// can settle in one after another when the assistant opens, and pulse in turn while it works.

import { motion, useReducedMotion } from "motion/react";
import { MARK_PATHS, MARK_VIEW_BOX } from "@/components/logo";
import { EASE } from "@/components/settings/model-map";

/** Each arc with its tone, which the theme sets. */
const ARCS = [
  ["a", "var(--logo-a)"],
  ["b", "var(--logo-b)"],
  ["c", "var(--logo-c)"],
] as const;

export function LogoMark({
  size = 28,
  draw = false,
  working = false,
  className,
}: {
  size?: number;
  /** Bring the arcs in one after another on mount. */
  draw?: boolean;
  /** Pulse the arcs in turn. */
  working?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const drawIn = draw && !reduceMotion;
  const pulse = working && !reduceMotion;
  return (
    <svg width={size} height={size} viewBox={MARK_VIEW_BOX} className={className} aria-hidden>
      {ARCS.map(([arc, fill], i) => (
        <motion.g
          key={arc}
          initial={false}
          animate={{ opacity: pulse ? [1, 0.3, 1] : 1 }}
          transition={pulse ? { duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.18 } : { duration: 0.2 }}
        >
          <motion.path
            d={MARK_PATHS[arc]}
            fill={fill}
            style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
            {...(drawIn ? { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.45, ease: EASE, delay: 0.1 + i * 0.1 } } : {})}
          />
        </motion.g>
      ))}
    </svg>
  );
}
