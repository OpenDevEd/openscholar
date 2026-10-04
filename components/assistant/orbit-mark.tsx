"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { useReducedMotion } from "motion/react";
import type { OrbitMotion } from "@/lib/assistant/activity";
import { orbitSeconds, orbitShape } from "@/public/assistant-branding/orbit";
import "@/public/assistant-branding/orbit.css";

/** The header and folded launcher share the same animation clock. */
export type OrbitClock = { motion: OrbitMotion; start: number } | null;
const properties = ["transform", "opacity", "strokeDashoffset"] as const;
const pose = (node: Element) => Object.fromEntries(properties.map((key) => [key, getComputedStyle(node)[key]]));

export function OrbitMark({ size = 28, motion = "still", clock, onComplete }: {
  size?: number;
  motion?: OrbitMotion;
  clock?: RefObject<OrbitClock>;
  onComplete?: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const ownClock = useRef<OrbitClock>(null);
  const timeline = clock ?? ownClock;
  const reduced = useReducedMotion();
  const interrupted = useRef<Array<{ node: Element; from: Record<string, string> }> | null>(null);

  // The Web Animations timeline is outside React. A state change settles from the painted pose.
  useEffect(() => {
    const root = svg.current!;
    let cancelled = false;
    const parts = interrupted.current ?? Array.from(root.querySelectorAll(".motion-part"), (node) => ({ node, from: pose(node) }));
    interrupted.current = null;
    root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    root.dataset.motion = "still";
    const bridges: Animation[] = [];
    const start = async () => {
      if (!reduced) {
        for (const { node, from } of parts) {
          const to = pose(node);
          if (!properties.every((key) => from[key] === to[key])) bridges.push(node.animate([from, to], { duration: 360, easing: "cubic-bezier(.22,.7,.25,1)" }));
        }
        await Promise.all(bridges.map((animation) => animation.finished.catch(() => {})));
      }
      if (cancelled) return;
      const now = Number(document.timeline.currentTime ?? 0);
      if (timeline.current?.motion !== motion) timeline.current = { motion, start: now };
      root.style.setProperty("--cycle", `${orbitSeconds[motion]}s`);
      root.dataset.motion = reduced ? "still" : motion;
      if (reduced && motion === "complete") onComplete?.();
      // A remounted launcher joins the gesture already playing instead of starting it again.
      for (const animation of root.getAnimations({ subtree: true })) animation.startTime = timeline.current.start;
    };
    void start();
    return () => {
      cancelled = true;
      if (bridges.some((animation) => animation.playState === "running")) interrupted.current = Array.from(root.querySelectorAll(".motion-part"), (node) => ({ node, from: pose(node) }));
      bridges.forEach((animation) => animation.cancel());
      // CSS keeps the painted pose for the next effect to capture. Unmount removes its animations.
    };
  }, [motion, reduced, timeline, onComplete]);

  return (
    <svg
      ref={svg}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className="assistant-mark"
      data-motion="still"
      data-once={motion === "complete" || undefined}
      aria-hidden
      style={{ "--mark-a": "var(--logo-a)", "--mark-b": "var(--logo-b)", "--mark-c": "var(--logo-c)", "--eye": "var(--foreground)" } as CSSProperties}
      onAnimationEnd={(event) => {
        if (motion === "complete" && event.target instanceof SVGElement && event.target.classList.contains("body")) onComplete?.();
      }}
      // Authored SVG only, shared with the exportable preview. No user or model content enters it.
      dangerouslySetInnerHTML={{ __html: orbitShape }}
    />
  );
}
