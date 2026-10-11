"use client";

// Small pieces the assistant's panel and its sheets share.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { TooltipHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Text that AI Elements' shimmer sweeps across while work runs. It holds still when motion is
 * reduced. Inline, so a line it's in still ends in an ellipsis when it's cut.
 */
export function WorkingText({ children }: { children: string }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <span className="text-muted-foreground">{children}</span>;
  return (
    <Shimmer as="span" duration={1.4} className="inline">
      {children}
    </Shimmer>
  );
}

export function IconButton({ label, shortcut, icon, onClick, small, disabled }: { label: string; shortcut?: string; icon: ReactNode; onClick?: () => void; small?: boolean; disabled?: boolean }) {
  return (
    <TooltipHint label={shortcut ? `${label}  ${shortcut}` : label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={cn("flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50", small ? "size-7" : "size-8")}
      >
        {icon}
      </button>
    </TooltipHint>
  );
}

/**
 * One line that may run past its end: it fades there while more of it is to the right, and
 * not once it all fits or it's scrolled to its end. `scrolls`: the line scrolls sideways;
 * otherwise what runs past stays cut, and the full record is a hover away.
 */
export function FadeRow({ scrolls = false, className, children }: { scrolls?: boolean; className?: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  // A ResizeObserver and the row's scroll: what's past its end changes with its width, its content and how far it's scrolled.
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => setMore(element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, []);
  return (
    <div ref={row} className={cn("min-w-0", scrolls ? "scrollbar-hover overflow-x-auto" : "overflow-hidden", more && "mask-r-from-[calc(100%-1.5rem)]", className)}>
      {children}
    </div>
  );
}
