"use client";

// Shared parts of the settings pages: section labels, tiles, the pill switch,
// the pager under a list, and the page entrance.

import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { cardEntrance, subtleSpring } from "@/lib/animation-config";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";

export type Ico = ComponentType<{ className?: string }>;

/** A labelled group on the page, with an optional control on the right. No box around it. */
export function Zone({
  label,
  aside,
  className,
  children,
}: {
  label: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-2.5", className)}>
      <div className="flex min-h-7 items-center justify-between gap-3 pl-1">
        <h2 className="text-xs font-medium text-muted-foreground">{label}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A tinted icon square. */
export function Tile({ icon: Icon, tint, className }: { icon: Ico; tint: string; className?: string }) {
  return (
    <span
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", className)}
      style={{ backgroundColor: `color-mix(in oklab, ${tint} 20%, var(--background))`, color: tint }}
    >
      <Icon className="size-4" />
    </span>
  );
}

/** A list of rows in one rounded box. */
export const LIST = "divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/60";

/**
 * Pill switch with a sliding highlight. The highlight is measured inside the group
 * (a resize observer keeps it right when fonts or labels change size), so it slides
 * the same inside a dialog or any moving container.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "sm",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string; icon?: Ico }>;
  label: string;
  size?: "sm" | "md";
}) {
  const buttons = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = buttons.current[value];
    if (!el) return;
    const measure = () => setBox({ left: el.offsetLeft, width: el.offsetWidth });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex shrink-0 rounded-full bg-muted/60 p-1">
      {box ? (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 rounded-full bg-primary/15 ring-1 ring-primary/40 transition-[transform,width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
          style={{ width: box.width, transform: `translateX(${box.left}px)` }}
        />
      ) : null}
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              buttons.current[o.id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "relative flex items-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors",
              size === "md" ? "h-9 px-4 text-sm" : "h-8 px-3 text-xs",
              on ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon ? <o.icon className={size === "md" ? "size-4" : "size-3.5"} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export type Pager = { page: number; pages: number; size: number; total: number; setPage: (page: number) => void };

/** Page state for a list of `total` items; the page clamps when the list shrinks. */
export function pagerOf(total: number, size: number, page: number, setPage: (page: number) => void): Pager {
  const pages = Math.max(1, Math.ceil(total / size));
  return { page: Math.min(page, pages), pages, size, total, setPage };
}

/**
 * The app's shared pager under a list. `rowHeight` reserves a full page of rows,
 * so a short last page doesn't move the pager.
 */
export function Paged({
  pager,
  rowHeight,
  label,
  children,
}: {
  pager: Pager;
  rowHeight: number;
  label: string;
  children: ReactNode;
}) {
  const multi = pager.pages > 1;
  return (
    <div>
      <div style={multi ? { minHeight: pager.size * rowHeight } : undefined}>{children}</div>
      {multi ? (
        <CommandCenterPagination
          currentPage={pager.page}
          totalPages={pager.pages}
          onPageChange={pager.setPage}
          totalItems={pager.total}
          itemsPerPage={pager.size}
          itemLabel={label}
        />
      ) : null}
    </div>
  );
}

// The settings card rises on first load (CommandCenterContainer), so the first page skips its own entrance.
let firstPage = true;

/**
 * Every settings page enters the same way: one fade and a 10px rise, like the
 * library, topic and history pages. It waits until `ready`, so a page lays out
 * its data at full size while hidden and never grows after it appears.
 */
export function Enter({ ready, children }: { ready: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [skip] = useState(() => firstPage || Boolean(reduceMotion));
  return (
    <motion.div
      initial={skip ? { opacity: 0 } : cardEntrance.initial}
      animate={ready ? cardEntrance.animate : undefined}
      transition={skip ? { duration: 0.15 } : subtleSpring}
      aria-busy={!ready}
      onAnimationStart={() => {
        firstPage = false;
      }}
    >
      {children}
    </motion.div>
  );
}
