"use client";

// The OpenScholar mark (public/icon.svg) as strokes, so it can draw itself in
// when the assistant opens and pulse along its circuit traces while it works.

import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE } from "@/components/settings/model-map";

const OUTLINE = "M 10 117.5 L 10 37.5 Q 10 17.5 30 22.5 L 75 32.5 L 120 22.5 Q 140 17.5 140 37.5 L 140 117.5 Q 140 132.5 120 127.5 L 75 117.5 L 30 127.5 Q 10 132.5 10 117.5 Z";
const SPINE = "M 75 117.5 L 75 32.5";
/** Each trace with its two end points. */
const TRACES: Array<{ d: string; ends: Array<[number, number]> }> = [
  { d: "M 40 57.5 L 40 72.5 L 55 87.5", ends: [[40, 57.5], [55, 87.5]] },
  { d: "M 55 47.5 L 65 57.5 L 65 97.5", ends: [[55, 47.5], [65, 97.5]] },
  { d: "M 40 92.5 L 50 102.5", ends: [[40, 92.5], [50, 102.5]] },
  { d: "M 110 57.5 L 110 72.5 L 95 87.5", ends: [[110, 57.5], [95, 87.5]] },
  { d: "M 95 47.5 L 85 57.5 L 85 97.5", ends: [[95, 47.5], [85, 97.5]] },
  { d: "M 110 92.5 L 100 102.5", ends: [[110, 92.5], [100, 102.5]] },
];

export function LogoMark({
  size = 28,
  draw = false,
  working = false,
  className,
}: {
  size?: number;
  /** Draw the mark in on mount. */
  draw?: boolean;
  /** Pulse a wave along the traces. */
  working?: boolean;
  className?: string;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const animateIn = draw && !reduceMotion;
  const stroke = `url(#${id})`;
  const line = (delay: number, duration = 0.5) =>
    animateIn ? { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration, ease: EASE, delay } } : {};
  const pulse = (i: number) =>
    working && !reduceMotion
      ? { animate: { opacity: [1, 0.25, 1] }, transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" as const, delay: i * 0.12 } }
      : {};
  return (
    <svg width={size} height={size} viewBox="0 0 150 150" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffb347" />
          <stop offset="100%" stopColor="#ff6b35" />
        </linearGradient>
      </defs>
      <g stroke={stroke} strokeWidth={size < 18 ? 12 : size < 24 ? 9 : 7} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <motion.path d={OUTLINE} {...line(0, 0.7)} />
        <motion.path d={SPINE} {...line(0.25, 0.35)} />
        {/* Below 18px the traces blur into a blob; the open book alone still reads. */}
        {(size < 18 ? [] : TRACES).map((t, i) => (
          <motion.g key={t.d} {...pulse(i)}>
            <motion.path d={t.d} {...line(0.4 + i * 0.06, 0.35)} />
            {t.ends.map(([cx, cy]) => (
              <motion.circle
                key={`${cx}-${cy}`}
                cx={cx}
                cy={cy}
                r={size < 24 ? 5 : 4}
                fill={stroke}
                stroke="none"
                {...(animateIn
                  ? { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { type: "spring", stiffness: 500, damping: 22, delay: 0.7 + i * 0.05 } }
                  : {})}
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              />
            ))}
          </motion.g>
        ))}
      </g>
    </svg>
  );
}
