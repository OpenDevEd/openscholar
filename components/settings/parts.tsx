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
export const LIST = "divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle";

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
  fill = false,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  /** `detail` sits after the label; `below` is a line under it, across the segment. */
  options: Array<{ id: T; label: string; icon?: Ico; detail?: ReactNode; below?: ReactNode }>;
  label: string;
  size?: "sm" | "md" | "lg";
  /**
   * Stretch across the row: with equal segments, whose labels are cut when they don't fit,
   * or with `"labels"`, where each segment is at least as wide as its label and none is cut.
   */
  fill?: boolean | "labels";
  className?: string;
}) {
  const buttons = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  // Segments with a line under the label are two-line cards rather than pills.
  const stacked = options.some((o) => o.below);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = buttons.current[value];
    // A value outside the options (picked elsewhere) leaves nothing highlighted.
    if (!el) {
      setBox(null);
      return;
    }
    const measure = () => setBox({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative bg-inset p-1",
        stacked ? "rounded-[1.375rem]" : "rounded-full",
        // Equal segments in one row, two by two on narrow screens.
        fill === true
          ? "@container/segments grid w-full auto-cols-fr grid-flow-col @max-[34rem]/configuration:grid-flow-row @max-[34rem]/configuration:grid-cols-2 @max-[34rem]/configuration:rounded-3xl"
          : fill
            ? "flex w-full"
            : "inline-flex shrink-0",
        className,
      )}
    >
      {box ? (
        <span
          aria-hidden
          className={cn(
            "absolute left-0 top-0 bg-primary/15 ring-1 ring-primary/40 transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            stacked ? "rounded-2xl" : "rounded-full",
          )}
          style={{ width: box.width, height: box.height, transform: `translate(${box.left}px, ${box.top}px)` }}
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
              "relative flex items-center gap-2 whitespace-nowrap font-medium transition-colors",
              stacked ? "rounded-2xl" : "rounded-full",
              stacked ? "px-4 py-2.5 text-sm" : size === "lg" ? "h-11 px-4 text-sm" : size === "md" ? "h-9 px-4 text-sm" : "h-8 px-3 text-xs",
              fill === true && "min-w-0 justify-center @min-[40rem]/segments:justify-between",
              fill === "labels" && "flex-1 justify-center",
              stacked && "flex-col items-stretch justify-center gap-2 @min-[40rem]/segments:justify-center",
              on ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {o.icon ? <o.icon className={size === "sm" ? "size-3.5" : "size-4"} /> : null}
              <span className="truncate">{o.label}</span>
            </span>
            {o.detail ? <span className="@max-[40rem]/segments:hidden">{o.detail}</span> : null}
            {o.below ? <span className="flex">{o.below}</span> : null}
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
 * A list read a cursor page at a time: what `useCursorPage` returns, its page size, and the
 * list's kept count. Without `total` (a search, whose matches aren't counted) the pager shows the page alone.
 */
export type StepPager = {
  list: { page: number; offset: number; items: unknown[]; hasPages: boolean; isStale: boolean; canPrevious: boolean; canNext: boolean; previous: () => void; next: () => void };
  size: number;
  total?: number;
  /** The total shown is an earlier view's, still waiting for this one's. */
  counting?: boolean;
};

/**
 * The app's shared pager under a list. `rowHeight` reserves a full page of rows,
 * so a short last page doesn't move the pager. A cursor-paged list steps previous and
 * next, and stays up, dimmed, while the page it steps to loads.
 */
export function Paged({
  pager,
  rowHeight,
  label,
  children,
}: {
  pager: Pager | StepPager;
  rowHeight: number;
  label: string;
  children: ReactNode;
}) {
  const multi = "list" in pager ? pager.list.hasPages : pager.pages > 1;
  // The rows or the total are an earlier view's: both stay up, dimmed and inert, until this view's arrive.
  const stale = "list" in pager && (pager.list.isStale || pager.counting === true);
  return (
    <div className={cn(stale && "opacity-60")} aria-busy={stale || undefined} inert={stale || undefined}>
      {/* `rowHeight` counts a row with its divider: a page has one divider fewer, inside the box's two borders. */}
      <div style={multi ? { minHeight: pager.size * rowHeight + 1 } : undefined}>{children}</div>
      {!multi ? null : "list" in pager ? (
        <CommandCenterPagination
          currentPage={pager.list.page}
          itemLabel={label}
          steps={{
            canPrevious: pager.list.canPrevious,
            canNext: pager.list.canNext,
            onPrevious: pager.list.previous,
            onNext: pager.list.next,
            offset: pager.list.offset,
            shown: pager.list.items.length,
            total: pager.total,
            pageCount: pager.total === undefined ? undefined : Math.max(1, Math.ceil(pager.total / pager.size)),
          }}
        />
      ) : (
        <CommandCenterPagination
          currentPage={pager.page}
          totalPages={pager.pages}
          onPageChange={pager.setPage}
          totalItems={pager.total}
          itemsPerPage={pager.size}
          itemLabel={label}
        />
      )}
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
