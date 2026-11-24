"use client";

// Shared parts of the settings pages: section labels, tiles, the pill switch,
// the pager under a list, and the page entrance.

import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { radioKeys, radioTabIndex } from "@/lib/radio-keys";
import { cardEntrance, subtleSpring } from "@/lib/animation-config";
import { CommandCenterPagination } from "@/components/command-center/command-center-pagination";
import { Spinner } from "@/components/ui/spinner";
import Link from "@/components/workspace-link";

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
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1 ps-1">
        <h2 className="shrink-0 text-xs font-medium text-muted-foreground">{label}</h2>
        {/* The aside takes the room left and no more: on a narrow screen it wraps under the label, and a long name in it is cut, not pushed out of the card. */}
        {aside ? <div className="flex min-w-0 justify-end">{aside}</div> : null}
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
  /** Left out where every segment is a link. */
  onChange?: (v: T) => void;
  /**
   * `detail` sits after the label; `below` is a line under it, across the segment. With `href` a
   * segment is a link to a page of its own: the group is then the pages' navigation, the open page's
   * segment is the current one, and the browser's Back returns to the page before.
   */
  options: Array<{ id: T; label: string; icon?: Ico; detail?: ReactNode; below?: ReactNode; href?: string }>;
  label: string;
  size?: "sm" | "md" | "lg";
  /**
   * Stretch across the row: with equal segments, whose labels are cut when they don't fit,
   * or with `"labels"`, where each segment is at least as wide as its label and none is cut.
   */
  fill?: boolean | "labels";
  className?: string;
}) {
  const buttons = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const links = options.some((o) => o.href);
  const Group = links ? "nav" : "div";
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
    // A row that wraps moves a segment without resizing it: the row's own size says when.
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [value]);
  return (
    <Group
      role={links ? undefined : "radiogroup"}
      aria-label={label}
      onKeyDown={links ? undefined : radioKeys}
      className={cn(
        "relative bg-inset p-1",
        // A row that takes a second line where its labels don't fit on one keeps the same corners on both.
        stacked || fill === "labels" ? "rounded-[1.375rem]" : "rounded-full",
        // Equal segments in one row, two by two on narrow screens.
        fill === true
          ? "@container/segments grid w-full auto-cols-fr grid-flow-col @max-[34rem]/configuration:grid-flow-row @max-[34rem]/configuration:grid-cols-2 @max-[34rem]/configuration:rounded-3xl"
          : fill
            ? "flex w-full flex-wrap"
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
      {options.map((o, index) => {
        const on = o.id === value;
        const look = cn(
          "relative flex items-center gap-2 whitespace-nowrap font-medium transition-colors",
          stacked ? "rounded-2xl" : "rounded-full",
          stacked ? "px-4 py-2.5 text-sm" : size === "lg" ? "h-11 px-4 text-sm" : size === "md" ? "h-9 px-4 text-sm" : "h-8 px-3 text-xs",
          fill === true && "min-w-0 justify-center @min-[40rem]/segments:justify-between",
          // Each segment starts from its label's width and they share what is left over. Where the row is too narrow for them all, the last ones go to a second line: no label is cut.
          fill === "labels" && "flex-auto justify-center",
          stacked && "flex-col items-stretch justify-center gap-2 @min-[40rem]/segments:justify-center",
          on ? "text-primary" : "text-muted-foreground hover:text-foreground",
        );
        const content = (
          <>
            <span className="flex min-w-0 items-center gap-2">
              {o.icon ? <o.icon className={size === "sm" ? "size-3.5" : "size-4"} /> : null}
              <span className="truncate">{o.label}</span>
            </span>
            {o.detail ? <span className="@max-[40rem]/segments:hidden">{o.detail}</span> : null}
            {/* The line under a label wraps where the segment is narrow, rather than running into the next one. */}
            {o.below ? <span className="flex whitespace-normal">{o.below}</span> : null}
          </>
        );
        if (o.href) {
          return (
            <Link key={o.id} ref={(el) => { buttons.current[o.id] = el; }} href={o.href} aria-current={on ? "page" : undefined} className={cn(look, "outline-none focus-visible:ring-2 focus-visible:ring-ring/50")}>
              {content}
            </Link>
          );
        }
        return (
          <button
            key={o.id}
            ref={(el) => {
              buttons.current[o.id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={radioTabIndex(on, index, options.some((option) => option.id === value))}
            onClick={() => onChange?.(o.id)}
            className={look}
          >
            {content}
          </button>
        );
      })}
    </Group>
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
 * its data at full size while hidden and never grows after it appears. Hidden,
 * it takes no clicks or focus: nothing on it can be changed before it shows.
 * Once shown it stays shown, whatever its data does after.
 */
export function Enter({ ready, children }: { ready: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [skip] = useState(() => firstPage || Boolean(reduceMotion));
  const [shown, setShown] = useState(ready);
  if (ready && !shown) setShown(true);
  const hidden = skip ? { opacity: 0 } : cardEntrance.initial;
  return (
    <motion.div
      initial={hidden}
      // Hidden by what it animates to, not only where it starts: inside an AnimatePresence that skips first entrances
      // (the screening page's), a start alone is passed over and the page would show before its data is in.
      animate={shown ? cardEntrance.animate : hidden}
      transition={skip ? { duration: 0.15 } : subtleSpring}
      aria-busy={!ready}
      inert={!shown}
      onAnimationStart={() => {
        firstPage = false;
      }}
    >
      {children}
    </motion.div>
  );
}

/** A button's label that a spinner covers while it works, so the button keeps its width. Its button needs `relative`. */
export function Working({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <>
      <span className={busy ? "invisible" : undefined}>{children}</span>
      {busy ? <Spinner className="absolute" /> : null}
    </>
  );
}
