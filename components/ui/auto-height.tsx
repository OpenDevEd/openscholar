"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE } from "@/components/settings/model-map";
import { cn } from "@/lib/utils";

/**
 * Takes its content's height as a slide: content that arrives or leaves after the first frame moves
 * what's below smoothly instead of in one frame. It clips to its height while it slides, leaving
 * room for its rows' focus rings.
 */
export function AutoHeight({ className, children }: { className?: string; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  const reduceMotion = useReducedMotion();
  // A ResizeObserver: the content's height is the outside system.
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.div className={cn("overflow-clip [overflow-clip-margin:4px]", className)} initial={false} animate={{ height }} transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: EASE }}>
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}
