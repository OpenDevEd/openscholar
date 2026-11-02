"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A row that may run past its edges: each edge fades while more of the row is past it, and not once the row is
 * scrolled to that edge or all of it fits. `scrolls`: the row scrolls sideways, its bar shown on hover (`scrollbar`
 * "hover") or never ("none"); otherwise what runs past stays cut, and the full record is a hover away.
 */
export function FadeRow({ as: Tag = "div", scrolls = false, scrollbar = "hover", className, children }: { as?: ElementType; scrolls?: boolean; scrollbar?: "hover" | "none"; className?: string; children: ReactNode }) {
  const row = useRef<HTMLElement>(null);
  const [past, setPast] = useState({ start: false, end: false });
  // A ResizeObserver, a MutationObserver and the row's scroll: what's past its edges changes with its width, what it
  // holds and how far it's scrolled.
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const scrolled = Math.abs(element.scrollLeft);
      const start = scrolled > 1;
      const end = scrolled + element.clientWidth < element.scrollWidth - 1;
      setPast((was) => (was.start === start && was.end === end ? was : { start, end }));
    };
    const resize = new ResizeObserver(measure);
    const watch = () => {
      resize.disconnect();
      resize.observe(element);
      for (const child of element.children) resize.observe(child);
    };
    watch();
    const added = new MutationObserver(() => {
      watch();
      measure();
    });
    added.observe(element, { childList: true });
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      resize.disconnect();
      added.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, []);
  return (
    <Tag
      ref={row}
      className={cn(
        "min-w-0",
        scrolls ? (scrollbar === "none" ? "overflow-x-auto [scrollbar-width:none]" : "scrollbar-hover overflow-x-auto") : "overflow-hidden",
        // Written out whole, so Tailwind finds them: each edge fades over its last 1.5rem.
        past.start && "ltr:mask-l-from-[calc(100%-1.5rem)] rtl:mask-r-from-[calc(100%-1.5rem)]",
        past.end && "ltr:mask-r-from-[calc(100%-1.5rem)] rtl:mask-l-from-[calc(100%-1.5rem)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
