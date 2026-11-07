"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A row that may run past its edges: each edge fades while more of the row is past it, and not once the row is
 * scrolled to that edge or all of it fits. `scrolls`: the row scrolls sideways, its bar shown on hover (`scrollbar`
 * "hover") or never ("none"); otherwise what runs past stays cut, and the full record is a hover away. `keepInView`
 * names, as a selector, what scrolls back into the row when its width changes or another item is chosen.
 */
export function FadeRow({ as: Tag = "div", scrolls = false, scrollbar = "hover", keepInView, className, children }: { keepInView?: string;  as?: ElementType; scrolls?: boolean; scrollbar?: "hover" | "none"; className?: string; children: ReactNode }) {
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
    const keep = () => {
      const kept = keepInView ? element.querySelector(keepInView)?.getBoundingClientRect() : null;
      if (!kept) return;
      const edges = element.getBoundingClientRect();
      const ltr = getComputedStyle(element).direction !== "rtl";
      // In reading order: how far the item's start is inside the row's start (below 0 is cut), and its end past the row's end.
      const start = ltr ? kept.left - edges.left : edges.right - kept.right;
      const end = ltr ? kept.right - edges.right : edges.left - kept.left;
      // The least move that brings it in, and when it's wider than the row, its start, so its name reads from the beginning.
      const move = start < 0 ? start : end > 0 ? Math.min(end, start) : 0;
      element.scrollLeft += ltr ? move : -move;
    };
    const resize = new ResizeObserver(() => {
      keep();
      measure();
    });
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
    // Choosing another item moves it too: a browser centres a control the keyboard (or a click that scrolls it into
    // view) focuses, which cuts the start of one wider than the row.
    const chosen = new MutationObserver(keep);
    if (keepInView) chosen.observe(element, { subtree: true, attributes: true, attributeFilter: ["aria-checked", "aria-selected"] });
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      resize.disconnect();
      added.disconnect();
      chosen.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [keepInView]);
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
